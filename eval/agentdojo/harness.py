"""Shared helpers: key loading, suite loading, task records, metric aggregation, markdown report."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from statistics import mean

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RESULTS = HERE / "results"
BENCH_VERSION = "v1.2.2"
SUITES = ["workspace", "banking", "travel", "slack"]
KEY_NAME = "GOOGLE_GENERATIVE_AI_API_KEY"


def load_key(required: bool = True) -> str:
    """Read the Gemini key from the environment or the repo-root .env (quotes, CR and spaces stripped)."""
    key = os.environ.get(KEY_NAME, "")
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line.startswith(KEY_NAME + "="):
                key = line.split("=", 1)[1]
    key = key.strip().strip("\"'").strip()
    if not key and required:
        sys.exit(f"{KEY_NAME} is empty. Put it in {env} (free key: https://aistudio.google.com) or the environment.")
    return key


def get_suite(name: str):
    import agentdojo.default_suites  # noqa: F401  (registers the suites)
    from agentdojo.task_suite.load_suites import get_suite as _get

    return _get(BENCH_VERSION, name)


def aggregate(records: list[dict]) -> dict:
    """Metrics from per-task records.

    record: {kind: "clean"|"attack", utility: bool, security: bool|None (True = injection succeeded),
             calls: [{tool, verdict, rt_ms, core_ms, waited}]}
    """
    clean = [r for r in records if r["kind"] == "clean"]
    att = [r for r in records if r["kind"] == "attack"]
    clean_calls = [c for r in clean for c in r["calls"]]
    all_calls = [c for r in records for c in r["calls"]]
    timed = [c for c in all_calls if not c.get("waited")]
    rate = lambda xs: (sum(xs) / len(xs)) if xs else None  # noqa: E731
    return {
        "n_clean": len(clean), "n_attack": len(att),
        "utility": rate([r["utility"] for r in clean]),
        "utility_under_attack": rate([r["utility"] for r in att]),
        "attack_success_rate": rate([bool(r["security"]) for r in att]),
        "false_block_rate_calls": rate([c["verdict"] != "ALLOW" for c in clean_calls]),
        "false_block_rate_tasks": rate([any(c["verdict"] != "ALLOW" for c in r["calls"]) for r in clean]),
        "mean_added_latency_ms": mean(c["rt_ms"] for c in timed) if timed else None,
        "mean_core_decision_ms": mean(c["core_ms"] for c in timed) if timed else None,
        "calls_total": len(all_calls),
        "calls_blocked": sum(c["verdict"] != "ALLOW" for c in all_calls),
    }


def _pct(x):
    return "n/a" if x is None else f"{100 * x:.1f}%"


def _ms(x):
    return "n/a" if x is None else f"{x:.1f} ms"


def markdown(title: str, by_defence: dict[str, dict]) -> str:
    cols = list(by_defence)
    rows = [
        ("Utility (no attack)", "utility", _pct),
        ("Utility under attack", "utility_under_attack", _pct),
        ("Attack success rate", "attack_success_rate", _pct),
        ("False-block rate (calls, no attack)", "false_block_rate_calls", _pct),
        ("False-block rate (tasks with any block)", "false_block_rate_tasks", _pct),
        ("Mean added latency per call (round trip)", "mean_added_latency_ms", _ms),
        ("Mean core decision time per call", "mean_core_decision_ms", _ms),
        ("Tool calls (blocked / total)", None, None),
        ("Runs (clean / attack)", None, None),
    ]
    out = [f"### {title}", "", "| metric | " + " | ".join(cols) + " |", "|---|" + "---|" * len(cols)]
    for label, key, fmt in rows:
        cells = []
        for c in cols:
            m = by_defence[c]
            if key:
                cells.append(fmt(m[key]))
            elif label.startswith("Tool"):
                cells.append(f"{m['calls_blocked']} / {m['calls_total']}")
            else:
                cells.append(f"{m['n_clean']} / {m['n_attack']}")
        out.append(f"| {label} | " + " | ".join(cells) + " |")
    return "\n".join(out) + "\n"


def save(name: str, payload: dict) -> Path:
    RESULTS.mkdir(exist_ok=True)
    p = RESULTS / f"{name}-{time.strftime('%Y%m%d-%H%M%S')}.json"
    p.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return p
