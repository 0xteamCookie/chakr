"""AgentDojo x AgentShield runner.

  python run.py --suite banking --ground-truth --attack important_instructions --limit 16
  python run.py --suite banking --model gemini-2.5-flash --defence agentshield --attack important_instructions --limit 5
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import harness
from harness import RESULTS, SUITES, aggregate, markdown, save


def latest(suite: str, model: str, attack: str, defence: str):
    pat = f"{suite}-{model}-{attack}-{defence}-*.json"
    files = sorted(RESULTS.glob(pat))
    return json.loads(files[-1].read_text(encoding="utf-8")) if files else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--suite", choices=SUITES, default="banking")
    ap.add_argument("--model", default="gemini-2.5-flash")
    ap.add_argument("--defence", choices=["none", "agentshield", "both"], default="both")
    ap.add_argument("--attack", default="important_instructions", help="AgentDojo attack name, or 'none'")
    ap.add_argument("--limit", type=int, default=5, help="number of user tasks")
    ap.add_argument("--injection-limit", type=int, default=2, help="injection tasks per user task")
    ap.add_argument("--sleep", type=float, default=4.0, help="seconds to sleep before each Gemini call (free-tier RPM)")
    ap.add_argument("--preset", choices=["strict", "balanced", "permissive"], default="balanced")
    ap.add_argument("--url", default=None, help="core URL (default $AGENTSHIELD_URL or http://localhost:4317)")
    ap.add_argument("--ground-truth", action="store_true", help="no LLM: replay scripted ground-truth calls")
    ap.add_argument("--user-tasks", nargs="*", help="only these user task ids (ground-truth mode)")
    a = ap.parse_args()

    from agentshield import Shield
    from specs import derive_specs

    suite = harness.get_suite(a.suite)
    try:
        reg = Shield.register_tools(derive_specs(suite), url=a.url)
    except Exception as e:
        sys.exit(f"Cannot reach the AgentShield core ({e}). Start it: cd packages/core && pnpm dev")
    print(f"registered {len(reg)} {a.suite} tools with the core")

    if a.ground_truth:
        import ground_truth

        recs = ground_truth.run(a.suite, a.limit, a.injection_limit, a.attack, a.preset, a.url, a.user_tasks)
        by = {d: aggregate(r) for d, r in recs.items()}
        path = save(f"{a.suite}-groundtruth-{a.attack}", {"config": vars(a), "metrics": by, "records": recs})
        md = markdown(f"{a.suite} ground-truth replay (no LLM), attack={a.attack}", by)
        injb = [r for r in recs["agentshield"] if r["kind"] == "attack"]
        extra = ""
        if injb:
            extra = (f"\nInjection write blocked by shield: "
                     f"{sum(bool(r.get('injection_write_blocked')) for r in injb)}/{len(injb)} attack runs\n")
        print(md + extra)
        path.with_suffix(".md").write_text(md + extra, encoding="utf-8")
        print(f"saved {path}")
        return

    key = harness.load_key()
    import live

    defences = ["none", "agentshield"] if a.defence == "both" else [a.defence]
    for d in defences:
        print(f"== {a.suite} / {a.model} / defence={d} / attack={a.attack}")
        base = f"{a.suite}-{a.model}-{a.attack}-{d}"
        cfg = {k: v for k, v in vars(a).items()}

        def checkpoint(records, d=d, base=base):
            save_path = RESULTS / f"{base}-partial.json"
            save_path.write_text(json.dumps({"config": cfg, "records": records}, default=str), encoding="utf-8")

        records, wall = live.run(a.suite, a.model, key, d, a.attack, a.limit, a.injection_limit, a.sleep,
                                 a.preset, a.url, checkpoint)
        (RESULTS / f"{base}-partial.json").unlink(missing_ok=True)
        save(base, {"config": cfg, "defence": d, "metrics": aggregate(records), "records": records,
                    "stopped_by_rate_limit": wall})
        if wall:
            break

    by = {}
    for d in ["none", "agentshield"]:
        j = latest(a.suite, a.model, a.attack, d)
        if j:
            by[d] = j["metrics"]
    if by:
        md = markdown(f"{a.suite} / {a.model} / attack={a.attack}", by)
        print(md)
        (RESULTS / f"{a.suite}-{a.model}-{a.attack}-summary.md").write_text(md, encoding="utf-8")


if __name__ == "__main__":
    main()
