# AgentDojo x AgentShield

Runs the [AgentDojo](https://github.com/ethz-spylab/agentdojo) benchmark (v1.2.2 suites: workspace, banking, travel,
slack) with and without AgentShield in front of the agent's tools.

```bash
cd eval/agentdojo
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt     # agentdojo 0.1.35 + in-repo SDK
cd ../../packages/core && pnpm dev                                          # core on :4317

# no LLM: replay scripted ground-truth calls through the shield (false blocks, latency, worst-case ASR)
.venv/Scripts/python run.py --suite banking --ground-truth --attack important_instructions --limit 16 --injection-limit 3

# real Gemini agent (key from repo-root .env: GOOGLE_GENERATIVE_AI_API_KEY)
.venv/Scripts/python run.py --suite banking --model gemini-2.5-flash --defence both \
    --attack important_instructions --limit 5 --injection-limit 1 --sleep 6
```

`--defence none|agentshield|both`, `--attack none|<agentdojo attack>`, `--preset strict|balanced|permissive`,
`--sleep` seconds before every Gemini call. Free-tier limits: 429s are retried with backoff (3 tries), and the run
stops at the first persistent rate-limit wall, saving what it has. Results go to `results/*.json` (+ `.md` summary),
gitignored except `.gitkeep`.

## How the defence works (`shield_defence.py`)
`SystemMessage, InitQuery, ShieldInit, llm, ToolsExecutionLoop([ShieldToolsExecutor, llm])`. `ShieldInit` opens a session
with `from_request(user_task_prompt)` before the model reads any tool output. `ShieldToolsExecutor` calls `/v1/check`
before each tool runs, executes only ALLOWed calls, and posts the formatted output to `/v1/result`. Blocked calls return
`{"blocked_by_agentshield": true, ...}` to the model and are removed from the trace AgentDojo uses for security checks.
An ESCALATE has no human here: it waits the core minimum (5 s, `approvalTimeoutMs`) and becomes DENY; those waits are
excluded from latency.

`specs.py` derives ToolSpecs from tool names: `get_/read_/search_/list_...` = read, LOW; `send_/transfer/delete/create/post/...`
= write, HIGH (updates MEDIUM); all outputs UNTRUSTED + PRIVATE; recipient-like args (`recipient`, `iban`, `to`, `channel`,
`url`, ...) are controlArgs; `body/message/content/text` are sinkArgs (PUBLIC for `post_*`, else INTERNAL). The core's
contract compiler grants a tool only if the request contains one of its keywords, so keywords come from the name tokens plus
a small synonym table; read tools additionally get per-suite domain words (`DOMAIN_WORDS`). Tune these to move
the false-block rate.

## Ground-truth mode (`--ground-truth`)
Clean: each user task's scripted calls are legitimate, so any block is a false block; utility is AgentDojo's own check on the
resulting state. Attack: the injection text is placed in the environment, the user's calls run, then the injection task's
calls are attempted in the same session, as a perfectly obedient hijacked agent would. This is a worst-case ASR (no model
resistance) and is not comparable to live-model numbers. The `none` column has no shield calls, hence no call counts.

Metrics: utility (no attack), utility under attack, attack success rate, false-block rate (calls and tasks, no attack),
mean added latency per call (client round trip of check + result), mean core decision time.
Note the core keeps tools/sessions in memory; the harness re-registers tools per session and retries a task if the core restarts.
