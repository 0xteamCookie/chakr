"""AgentShield as an AgentDojo defence.

Pipeline (agentshield): SystemMessage, InitQuery, ShieldInit, llm, ToolsExecutionLoop([ShieldToolsExecutor, llm])

- ShieldInit opens a core session from the user's task prompt BEFORE the model sees any tool output.
- ShieldToolsExecutor asks the core to check every tool call before it executes, runs allowed calls,
  and posts their (formatted) output to /v1/result so later arguments can be traced to it.
- A blocked call returns a structured message to the model and is never executed.
"""

from __future__ import annotations

import json
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from agentdojo.agent_pipeline.base_pipeline_element import BasePipelineElement
from agentdojo.agent_pipeline.llms.google_llm import EMPTY_FUNCTION_NAME
from agentdojo.agent_pipeline.tool_execution import is_string_list, tool_result_to_str
from agentdojo.functions_runtime import EmptyEnv, Env, FunctionsRuntime
from agentdojo.types import ChatMessage, ChatToolResultMessage, text_content_block_from_string
from ast import literal_eval

from agentshield import Shield

ESCALATION_TIMEOUT_MS = 5000  # core minimum; an unanswered escalation becomes DENY


@dataclass
class CallRecord:
    tool: str
    verdict: str
    reasons: list[str]
    round_trip_ms: float  # check + result HTTP round trips measured by the client
    core_ms: float  # decision time reported by the core
    escalated_wait: bool  # waited for the approval timeout (excluded from latency averages)
    call_obj_id: int = 0


@dataclass
class ShieldState:
    """Per-task state shared by the two pipeline elements."""
    url: str | None = None
    preset: str = "balanced"
    agent_id: str = "agentdojo"
    tool_names: list[str] | None = None
    specs: list | None = None  # re-registered before every session (the core keeps tools in memory only)
    shield: Shield | None = None
    records: list[CallRecord] = field(default_factory=list)
    blocked_calls: set[int] = field(default_factory=set)  # id() of FunctionCall objects that were blocked

    def reset(self) -> None:
        self.shield = None
        self.records = []
        self.blocked_calls = set()


class ShieldInit(BasePipelineElement):
    name = "shield_init"

    def __init__(self, state: ShieldState) -> None:
        self.state = state

    def query(self, query: str, runtime: FunctionsRuntime, env: Env = EmptyEnv(),
              messages: Sequence[ChatMessage] = [], extra_args: dict = {}):
        self.state.reset()
        if self.state.specs:
            Shield.register_tools(self.state.specs, url=self.state.url)
        self.state.shield = Shield.from_request(
            query, agent_id=self.state.agent_id, tools=self.state.tool_names, preset=self.state.preset,  # type: ignore[arg-type]
            settings={"approvalTimeoutMs": ESCALATION_TIMEOUT_MS}, url=self.state.url)
        return query, runtime, env, messages, extra_args


def guarded_call(state: ShieldState, runtime: FunctionsRuntime, env: Env, tool_call, formatter) -> ChatToolResultMessage:
    """check -> execute -> result for one AgentDojo FunctionCall. Returns the tool message for the model."""
    shield = state.shield
    assert shield is not None, "ShieldInit must run before ShieldToolsExecutor"
    for k, v in tool_call.args.items():
        if isinstance(v, str) and is_string_list(v):
            tool_call.args[k] = literal_eval(v)
    cid = shield.next_id()
    t0 = time.perf_counter()
    d = shield.check(tool_call.function, dict(tool_call.args), cid)
    t_check = (time.perf_counter() - t0) * 1000
    waited = any("no decision before timeout" in r for r in d.reasons)
    rec = CallRecord(tool_call.function, d.verdict, d.reasons, t_check, d.latency_ms, waited, id(tool_call))
    state.records.append(rec)
    if not d.allowed:
        state.blocked_calls.add(id(tool_call))
        msg = json.dumps({"blocked_by_agentshield": True, "verdict": d.verdict, "reasons": d.reasons})
        return ChatToolResultMessage(role="tool", content=[text_content_block_from_string(msg)],
                                     tool_call_id=tool_call.id, tool_call=tool_call, error=None)
    result, error = runtime.run_function(env, tool_call.function, tool_call.args)
    text = formatter(result)
    t1 = time.perf_counter()
    if error is None:
        shield.result(tool_call.function, dict(tool_call.args), text, cid)
    rec.round_trip_ms += (time.perf_counter() - t1) * 1000
    return ChatToolResultMessage(role="tool", content=[text_content_block_from_string(text)],
                                 tool_call_id=tool_call.id, tool_call=tool_call, error=error)


class ShieldToolsExecutor(BasePipelineElement):
    """Drop-in replacement for ToolsExecutor that routes every call through the shield."""
    name = "shield_tools_executor"

    def __init__(self, state: ShieldState, formatter=tool_result_to_str) -> None:
        self.state = state
        self.formatter = formatter

    def query(self, query: str, runtime: FunctionsRuntime, env: Env = EmptyEnv(),
              messages: Sequence[ChatMessage] = [], extra_args: dict = {}):
        if not messages or messages[-1]["role"] != "assistant" or not messages[-1]["tool_calls"]:
            return query, runtime, env, messages, extra_args
        results = []
        for tc in messages[-1]["tool_calls"]:
            if tc.function == EMPTY_FUNCTION_NAME or tc.function not in runtime.functions:
                results.append(ChatToolResultMessage(
                    role="tool", content=[text_content_block_from_string("")], tool_call_id=tc.id, tool_call=tc,
                    error=f"Invalid tool {tc.function} provided."))
                continue
            results.append(guarded_call(self.state, runtime, env, tc, self.formatter))
        return query, runtime, env, [*messages, *results], extra_args
