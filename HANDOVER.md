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
  - After a reset, `/audit` shows the public anchor as "written by an earlier database" (amber, not broken) until the first **Anchor now**. Anchoring then works even though the contract's counter is far ahead (it was at 3345 on 2026-10-27): the core sends one past the on-chain counter.
- **Restart core after changing `.env`.** It is read once at startup (`packages/core/src/env.ts`). `/api/health` should show `"anchor": "polygon-amoy"`; if it says `local`, the core started without the `.env`.

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
  - AgentDojo, worst-case ground truth: banking 9.1%, Slack 9.4% of calls.
  - Real model: Claude Haiku 5.5 on all 2,108 InjecAgent cases blocked 0 of 147 legitimate calls.
- **"What still gets through?"** AgentDojo Slack, 35% under a perfectly obedient hijacked agent: visiting the attacker's URL is a low-tier read (16 of 28), a link sent to a real teammate needs the causal check, which ground-truth replay cannot run (8), and the invite tool's email field is not marked as a destination (4). Say it plainly; it is measured, not tuned away.
- **"Why blockchain?"** Whoever controls the database could rewrite the log and recompute every hash. The head written on-chain proves they did. It runs on Amoy, a testnet, so it shows the mechanism, not production finality.

## Measured numbers

| Benchmark | Result |
|---|---|
| InjecAgent, 1,054 attacks against a compromised agent | No defence: 100% attack success. Full AgentShield: 0%, with 0% false blocks. |
| InjecAgent stress case (attacker tools inside the contract) | 0%, with 425 calls escalated to a human |
| Decision latency | p50 0.11 ms |
| Adaptive suite (`pnpm eval:adaptive`), 63 bypass attempts | 0 unexplained bypasses, 15 documented known limits |
| AgentDojo banking, ground truth | Attack success 100% → 4.2%. Utility 100% → 81.2%. False blocks 9.1%. |
| AgentDojo Slack, ground truth (re-run after the fix) | Attack success 100% → 35.0%. Utility 100% → 81.2%. False blocks 9.4%. |
| InjecAgent with a real model, Claude Haiku 5.5, 2,108 cases | Model fell for 0 (base) and 2 (enhanced) attacks without the shield; both stopped. 0 of 147 legitimate calls blocked. About $0.70. |

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

- 56 tests pass.
- InjecAgent: full AgentShield at 0% attack success and 0% false blocks.
- Adaptive suite: "Unexplained bypasses: none".

## Open items, in priority order

1. **Rehearse the demo once with a timer.** Restart core first so it loads `.env` (see Windows notes).
   - The approval in step 2 must be clicked in the UI.
   - With no answer, an approval times out to deny.
   - Checked read-only on 2026-10-27: Amoy RPC reachable, anchor wallet holds about 0.077 test POL (dozens of anchors), contract deployed, Gemini key accepted. "Anchor now" itself was not pressed.
2. **AgentDojo Slack is the weak spot** (35% worst-case attack success). The three causes are listed in Q&A above. Fixing them is a design choice (for example treating a fetch to an untrusted URL as data leaving the system), so it was left for the team rather than tuned to the benchmark.
3. **Real Gmail inbox for `/live` (built 2026-10-30).** "Load from Gmail" reads the newest messages from `GMAIL_USER` (read-only IMAP, nothing marked as read) into the inbox the agent works on. Payments and outgoing mail stay simulated, and with a real inbox the outcome is judged against the saved payees: money to any other account counts as stolen. Rehearse it with the exact email you will send on stage, and keep the recorded demo inbox as the fallback if the venue network blocks IMAP (port 993).

Done on 2026-10-27:
- Every `/pitch` slide checked in a browser, no console errors. Slide 3 looped back to one card while you talked; it now reveals the three checks once and keeps them on screen.
- README numbers updated (live agent, AgentDojo, adaptive suite, real-model run).
- AgentDojo Slack re-run after the fix (banking re-run too; it reproduced the earlier numbers exactly).
- Anchoring after a database reset fixed: the contract reverted any seq at or below its counter, and `/audit` reported a fresh database as tampered. Covered by two new tests.

## Secrets

- `.env` is gitignored. Never commit it.
- `ANCHOR_PRIVATE_KEY` is a throwaway Amoy wallet funded with test POL. Rotate it after the event.
- Revoke the Gemini key after the event.
