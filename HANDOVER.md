# AgentShield handover

Team teamCookie(), CHAKRAVYUH 2026, problem statement CB-05. Current pitch deck: `docs/AgentShield_teamCookie_v2_short.pdf`.
AgentShield sits between an AI agent and its tools. Every tool call is checked before it runs, and every decision is a
signed, hash-chained receipt whose head is anchored on Polygon Amoy.

## Run it

You need Node 20+ and pnpm 12. Put the `.env` you were sent at the repo root. Every variable is listed in `.env.example`.

```bash
pnpm install
cd packages/core && pnpm dev          # core API on :4317 (loads ../../.env)
cd apps/dashboard && pnpm dev         # dashboard on :3000
```

Or run everything with Docker: `docker compose up --build`.

### Windows notes

- **Run scripts per package.** Root `pnpm test` / `pnpm typecheck` fail under pnpm 12 on Windows, so `cd` into the package first.
- **Don't run `next dev` and `next build` together.** They share `apps/dashboard/.next` and break each other. If pages show up unstyled, stop everything, delete `.next` and start again.
- **Prisma lock on install.** If `pnpm install` fails on prisma with an EPERM error, stop the running core first, because it holds the Prisma engine file.
- **Reset the demo database** before presenting: stop core, delete `packages/core/.data/agentshield.db`, then start core again. Keep `.data/keys`.

## Demo (10 minutes total)

| Time | What | Where |
|---|---|---|
| 0:00–3:00 | Pitch, 6 slides. Press F for fullscreen and N for speaker notes. | `/pitch` |
| 3:00–6:00 | Live demo (below) | `/live`, then `/audit` |
| 6:00–10:00 | Q&A. Keep these tabs open as backup. | `/evaluation`, `/console` |

### Live demo

1. **Shield OFF.** Open `/live`, choose the task "Pay the invoices that are due" and press Run. The real Gemini agent pays the attacker 48,000.
2. **Shield ON, same task.**
   - The legitimate 12,000 is paid at once, because that account is in the user's saved payees.
   - The attacker's 48,000 stops at an approval card that says "Recommended: deny" and that the account came from an email.
   - Click Deny.
3. **Audit log.** Open `/audit` and press Anchor now. This writes a real transaction to Polygon Amoy; click through to Polygonscan.
4. **Tampering.** Press Rewrite history. The local check still passes, but the on-chain check catches the rewrite. Then press Restore.

### Fallbacks

- **Gemini rate-limited or offline:** `/live` switches to a recorded replay automatically and shows a banner. The Shield checks in the replay are still real.
- **Live page fails entirely:** use `/console` and run the scripted scenarios with "Run side by side". No API key is needed.
- **RPC blocked by the venue network:** use WARP. The RPC we use is `polygon-amoy-bor-rpc.publicnode.com`.

### Answers for Q&A

- **"Isn't the agent fake?"** The `/live` agent is real Gemini. The benchmarks use a fully compromised agent on purpose, because that is the worst case for the shield.
- **"Do you block legitimate work?"**
  - InjecAgent: 0% false blocks.
  - AgentDojo, worst-case ground truth: banking 9.1%, Slack 21.9% before the latest fix (Slack not re-run since). Be honest that this is the weak spot.
- **"Why blockchain?"** Whoever controls the database could rewrite the log and recompute every hash. The head written on-chain proves they did. It runs on Amoy, a testnet, so it shows the mechanism, not production finality.

## Measured numbers

| Benchmark | Result |
|---|---|
| InjecAgent, 1,054 attacks against a compromised agent | No defence: 100% attack success. Full AgentShield: 0%, with 0% false blocks. |
| InjecAgent stress case (attacker tools inside the contract) | 0%, with 425 calls escalated to a human |
| Decision latency | p50 0.09 ms |
| Adaptive suite (`pnpm eval:adaptive`), 63 bypass attempts | 0 unexplained bypasses, 15 documented known limits |
| AgentDojo banking, ground truth | Attack success 100% → 4.2%. Utility 100% → 81.2%. False blocks 9.1%. |
| AgentDojo Slack, ground truth (before the latest fix) | Attack success 100% → 39.6%. False blocks 21.9%. |

The AgentDojo numbers are also in `eval/agentdojo/summary.json`. Workspace and travel suites have not been run.

## Repo map

```
packages/core        engine (contract, provenance, policy, causal, receipts), API, scenarios, live agent (src/live.ts), evals
packages/sdk         TypeScript SDK: Shield.fromRequest(task).wrap(tools)
packages/mcp-proxy   MCP proxy for Claude Desktop / Cursor / VS Code
python/              Python SDK + LangChain adapter
eval/agentdojo       AgentDojo harness (Python, has its own README)
apps/dashboard       Next.js: /pitch /live /audit /evaluation (+ /console fallback, / landing)
contracts            AuditAnchor.sol (deployed on Amoy at 0x907ad5456ed5abc78060c65f433f679f5a326dba)
docker/, docker-compose.yml, policies/ (OPA rego)
```

## Checks before you push

```bash
cd packages/core && pnpm test && pnpm typecheck && pnpm eval && pnpm eval:adaptive
cd apps/dashboard && pnpm typecheck && pnpm build
```

What these should show:

- 54 tests pass.
- InjecAgent: full AgentShield at 0% attack success and 0% false blocks.
- Adaptive suite: "Unexplained bypasses: none".

## Open items, in priority order

1. **Rehearse the demo once with a timer.**
   - The approval in step 2 must be clicked in the UI.
   - With no answer, an approval times out to deny.
2. **Check every slide of `/pitch` once in a browser.** After the trim, the new "Three checks" slide (slide 3) has not been looked at.
3. **Update the README numbers.** The README predates the live agent and the AgentDojo work.
4. **AgentDojo false blocks are the known weak spot.**
   - The remaining blocks come from the principled no-untrusted-recipient rule, so relaxing it would weaken the defence.
   - Report the numbers honestly rather than tuning to the benchmark.
5. **Optional, not built:** a real Gmail inbox for the live agent. It was skipped for stage reliability.

## Secrets

- `.env` is gitignored. Never commit it.
- `ANCHOR_PRIVATE_KEY` is a throwaway Amoy wallet funded with test POL. Rotate it after the event.
- Revoke the Gemini key after the event.
