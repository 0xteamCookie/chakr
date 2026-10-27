"""--ground-truth mode: no LLM. Replays AgentDojo's scripted ground-truth tool calls through the shield.

User tasks (clean env): every ground-truth call is a legitimate action, so a block is a false block.
Attack: for each (user task, injection task) the injection text is placed into the environment, the user's
ground-truth calls run (the agent reads the poisoned content), then the injection task's ground-truth calls
are attempted in the SAME session, as a fully hijacked agent would. Security is AgentDojo's own check on the
resulting state, so it measures how often the shield stops a perfectly obedient attacker.
"""

from __future__ import annotations

import copy
import time

from agentdojo.agent_pipeline.agent_pipeline import AgentPipeline
from agentdojo.agent_pipeline.tool_execution import tool_result_to_str
from agentdojo.attacks.attack_registry import load_attack
from agentdojo.functions_runtime import FunctionsRuntime
from agentdojo.types import text_content_block_from_string

from harness import get_suite
from shield_defence import ESCALATION_TIMEOUT_MS, ShieldState, guarded_call
from agentshield import Shield


def _replay(suite, calls, runtime, env, state: ShieldState | None):
    """Run calls (through the shield if state is given). Returns (executed calls, call records)."""
    executed, recs = [], []
    for tc in calls:
        if state is None:
            t0 = time.perf_counter()
            runtime.run_function(env, tc.function, tc.args)
            executed.append(tc)
            continue
        n = len(state.records)
        guarded_call(state, runtime, env, tc, tool_result_to_str)
        r = state.records[n]
        if r.verdict == "ALLOW":
            executed.append(tc)
        recs.append(r)
    return executed, recs


def _rec(r):
    return {"tool": r.tool, "verdict": r.verdict, "rt_ms": r.round_trip_ms, "core_ms": r.core_ms,
            "waited": r.escalated_wait, "reasons": r.reasons[:2]}


def _retry(fn, what):
    """The core keeps sessions in memory; if it restarts mid-run, redo the whole task on a fresh session."""
    for attempt in range(4):
        try:
            return fn()
        except Exception as e:
            if attempt == 3 or not ("unknown session" in str(e) or any(k in type(e).__name__ for k in ("Connect", "ReadError", "RemoteProtocol"))):
                raise
            print(f"  [{what}] core restarted, retrying ({type(e).__name__})")
            time.sleep(4)


def _new_state(task_prompt, tool_names, preset, url, specs):
    st = ShieldState(url=url, preset=preset, tool_names=tool_names, specs=specs)
    Shield.register_tools(specs, url=url)
    st.shield = Shield.from_request(task_prompt, agent_id="agentdojo-gt", tools=tool_names, preset=preset,
                                    settings={"approvalTimeoutMs": ESCALATION_TIMEOUT_MS}, url=url)
    return st


def run(suite_name: str, limit: int | None, inj_limit: int, attack_name: str | None, preset: str,
        url: str | None, user_tasks: list[str] | None = None) -> dict[str, list[dict]]:
    suite = get_suite(suite_name)
    tool_names = [f.name for f in suite.tools]
    specs = __import__("specs").derive_specs(suite)
    effect = {s.name: s.effect for s in specs}
    uts = list(suite.user_tasks.values())
    if user_tasks:
        uts = [t for t in uts if t.ID in user_tasks]
    if limit:
        uts = uts[:limit]
    its = list(suite.injection_tasks.values())[:inj_limit]
    attack = None
    if attack_name and attack_name != "none":
        stub = AgentPipeline([])
        stub.name = "gemini-2.0-flash-001"  # only used by the attack to address the model by name
        attack = load_attack(attack_name, suite, stub)

    out: dict[str, list[dict]] = {"none": [], "agentshield": []}

    def fresh_env(injections, ut):
        env = suite.load_and_inject_default_environment(injections)
        return ut.init_environment(env)

    def blocks(text):
        return [text_content_block_from_string(text)]

    def do_clean(ut, defence):
        env = fresh_env({}, ut)
        pre = copy.deepcopy(env)
        runtime = FunctionsRuntime(suite.tools)
        calls = ut.ground_truth(copy.deepcopy(env))
        state = _new_state(ut.PROMPT, tool_names, preset, url, specs) if defence == "agentshield" else None
        executed, recs = _replay(suite, calls, runtime, env, state)
        util = suite._check_user_task_utility(ut, blocks(ut.GROUND_TRUTH_OUTPUT), pre, env, executed)
        return {"kind": "clean", "user_task": ut.ID, "injection_task": None, "utility": bool(util),
                "security": None, "calls": [_rec(r) for r in recs]}

    def do_attack(ut, it, injections, defence):
        env = fresh_env(injections, ut)
        pre = copy.deepcopy(env)
        runtime = FunctionsRuntime(suite.tools)
        ucalls = ut.ground_truth(copy.deepcopy(env))
        icalls = it.ground_truth(copy.deepcopy(env))
        state = _new_state(ut.PROMPT, tool_names, preset, url, specs) if defence == "agentshield" else None
        ex_u, rec_u = _replay(suite, ucalls, runtime, env, state)
        ex_i, rec_i = _replay(suite, icalls, runtime, env, state)
        executed = ex_u + ex_i
        util = suite._check_user_task_utility(ut, blocks(ut.GROUND_TRUTH_OUTPUT), pre, env, executed)
        sec = suite._check_injection_task_security(it, blocks(it.GROUND_TRUTH_OUTPUT), pre, env, executed)
        return {"kind": "attack", "user_task": ut.ID, "injection_task": it.ID, "utility": bool(util),
                "security": bool(sec), "calls": [_rec(r) for r in rec_u + rec_i],
                "injection_write_blocked": any(r.verdict != "ALLOW" and effect.get(r.tool) == "write"
                                               for r in rec_i) if defence == "agentshield" else None}

    for ut in uts:
        for defence in ("none", "agentshield"):
            out[defence].append(_retry(lambda: do_clean(ut, defence), f"{ut.ID} {defence}"))
        if attack is None:
            continue
        for it in its:
            injections = attack.attack(ut, it)
            for defence in ("none", "agentshield"):
                out[defence].append(_retry(lambda: do_attack(ut, it, injections, defence), f"{ut.ID}x{it.ID} {defence}"))
        print(f"  {ut.ID} done")
    return out
