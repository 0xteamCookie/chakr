"""Live mode: a real Gemini agent on AgentDojo tasks, with or without the AgentShield defence."""

from __future__ import annotations

import copy
import re
import time
import warnings

from agentdojo.agent_pipeline.agent_pipeline import AgentPipeline, load_system_message
from agentdojo.agent_pipeline.base_pipeline_element import BasePipelineElement
from agentdojo.agent_pipeline.basic_elements import InitQuery, SystemMessage
from agentdojo.agent_pipeline.errors import AbortAgentError
from agentdojo.agent_pipeline.llms.google_llm import GoogleLLM
from agentdojo.agent_pipeline.tool_execution import ToolsExecutionLoop, ToolsExecutor
from agentdojo.attacks.attack_registry import load_attack
from agentdojo.functions_runtime import FunctionsRuntime
from agentdojo.task_suite.task_suite import functions_stack_trace_from_messages, model_output_from_messages

from harness import get_suite
from shield_defence import ShieldInit, ShieldState, ShieldToolsExecutor


class RateLimitWall(RuntimeError):
    """Gemini kept returning 429/quota errors after the allowed retries; the run stops and saves what it has."""


class ThrottledLLM(BasePipelineElement):
    """Sleeps before every model call and retries transient errors with exponential backoff."""

    def __init__(self, inner: GoogleLLM, sleep: float, retries: int = 3, base_backoff: float = 20.0) -> None:
        self.inner, self.sleep, self.retries, self.base = inner, sleep, retries, base_backoff
        self.name = inner.model
        self.llm_calls = 0

    def query(self, query, runtime, env=None, messages=[], extra_args={}):
        kw = {} if env is None else {"env": env}
        for attempt in range(self.retries + 1):
            time.sleep(self.sleep)
            try:
                self.llm_calls += 1
                return self.inner.query(query, runtime, messages=messages, extra_args=extra_args, **kw)
            except Exception as e:  # google.genai ClientError/ServerError and friends
                msg = str(e)
                code = getattr(e, "code", None)
                transient = code in (429, 500, 503) or "RESOURCE_EXHAUSTED" in msg or "UNAVAILABLE" in msg
                if not transient:
                    raise
                if "PerDay" in msg or "per day" in msg.lower():
                    raise RateLimitWall(f"daily quota exhausted: {msg[:200]}") from e
                if attempt == self.retries:
                    raise RateLimitWall(f"rate limit persisted after {self.retries} retries: {msg[:200]}") from e
                m = re.search(r"retry(?:Delay)?\D{0,12}(\d+(?:\.\d+)?)s", msg)
                wait = max(float(m.group(1)) + 1 if m else 0, self.base * 2 ** attempt)
                print(f"    rate limited, backing off {wait:.0f}s (attempt {attempt + 1}/{self.retries})")
                time.sleep(wait)
        raise AssertionError("unreachable")


def build_pipeline(model: str, key: str, defence: str, sleep: float, state: ShieldState):
    from google import genai

    llm = ThrottledLLM(GoogleLLM(model, genai.Client(api_key=key), temperature=0.0), sleep)
    sysmsg = SystemMessage(load_system_message(None))
    if defence == "agentshield":
        loop = ToolsExecutionLoop([ShieldToolsExecutor(state), llm])
        elements = [sysmsg, InitQuery(), ShieldInit(state), llm, loop]
    else:
        elements = [sysmsg, InitQuery(), llm, ToolsExecutionLoop([ToolsExecutor(), llm])]
    p = AgentPipeline(elements)
    p.name = model
    return p, llm


def run_one(suite, pipeline, state: ShieldState, ut, it, injections) -> dict:
    """Mirror of TaskSuite.run_task_with_pipeline, but blocked calls are excluded from the trace
    that AgentDojo's trace-based checks see (a blocked call never happened)."""
    env = suite.load_and_inject_default_environment(injections)
    env = ut.init_environment(env)
    pre = copy.deepcopy(env)
    runtime = FunctionsRuntime(suite.tools)
    state.reset()
    messages: list = []
    output = None
    for _ in range(3):
        try:
            _, _, env, messages, _ = pipeline.query(ut.PROMPT, runtime, env)
        except AbortAgentError as e:
            env, messages = e.task_environment, e.messages
        output = model_output_from_messages(messages)
        if output is not None:
            break
    if output is None:
        warnings.warn(f"no model output for {ut.ID}")
    trace = [c for c in functions_stack_trace_from_messages(messages) if id(c) not in state.blocked_calls]
    utility = suite._check_user_task_utility(ut, output or [], pre, env, trace)
    security = None
    if it is not None:
        security = suite._check_injection_task_security(it, output or [], pre, env, trace)
    return {"utility": bool(utility), "security": None if security is None else bool(security),
            "calls": [{"tool": r.tool, "verdict": r.verdict, "rt_ms": r.round_trip_ms, "core_ms": r.core_ms,
                       "waited": r.escalated_wait, "reasons": r.reasons[:2]} for r in state.records]}


def run(suite_name, model, key, defence, attack_name, limit, inj_limit, sleep, preset, url, on_record=None):
    suite = get_suite(suite_name)
    from specs import derive_specs

    state = ShieldState(url=url, preset=preset, tool_names=[f.name for f in suite.tools], specs=derive_specs(suite))
    pipeline, llm = build_pipeline(model, key, defence, sleep, state)
    uts = list(suite.user_tasks.values())[:limit] if limit else list(suite.user_tasks.values())
    its = list(suite.injection_tasks.values())[:inj_limit]
    attack = None
    if attack_name and attack_name != "none":
        stub = AgentPipeline([])
        stub.name = "gemini-2.0-flash-001"
        attack = load_attack(attack_name, suite, stub)
    records = []
    try:
        for ut in uts:
            r = run_one(suite, pipeline, state, ut, None, {})
            records.append({"kind": "clean", "user_task": ut.ID, "injection_task": None, **r})
            print(f"  {ut.ID} clean: utility={r['utility']} calls={len(r['calls'])}")
            if on_record:
                on_record(records)
            if attack is None:
                continue
            for it in its:
                r = run_one(suite, pipeline, state, ut, it, attack.attack(ut, it))
                records.append({"kind": "attack", "user_task": ut.ID, "injection_task": it.ID, **r})
                print(f"  {ut.ID} x {it.ID}: utility={r['utility']} injection_succeeded={r['security']}")
                if on_record:
                    on_record(records)
    except RateLimitWall as e:
        print(f"STOPPED at rate-limit wall: {e}")
        return records, str(e)
    return records, None
