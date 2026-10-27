# AgentShield

**Intent-bound, provenance-aware execution control for AI agents.**
The agent can think anything. It can only do what the user actually asked for.

Team **teamCookie()** · CHAKRAVYUH 2026 · Problem statement CB-05 (Cybersecurity & Blockchain)

![Landing page](docs/screenshot-home.png)

AgentShield sits between an AI agent and its tools. Every tool call passes through four layers before it runs,
and every decision becomes a signed, hash-chained receipt.

| Layer | What it does | Model calls |
|---|---|---|
| **1. Intent contract** | Compiles the user's request (and nothing else) into a signed, frozen allow-list of actions *before* the agent reads anything untrusted. Injected text can't widen it. | none |
| **2. Argument provenance** | Traces every argument to who wrote it (integrity) and who may see it (confidentiality), through base64, hex, URL-encoding, homoglyphs, zero-width characters and spelled-out values. Secret data can't flow into a public sink. | none |
| **3. Policy + risk tier** | Org rules: tiers, limits, forbidden patterns, mandatory human approval. Built-in evaluator, or Open Policy Agent when `OPA_URL` is set. | none |
| **4. Causal check** | Only for high-risk calls the rules can't settle: replay the step with the *user's task masked*. If the agent still takes the action, the content it read is driving it (masked re-execution, as in MELON, ICML 2025), so it is denied. | 1 replay, rarely |
| Detector (advisory) | Heuristic injection score (Prompt Guard can be plugged in). Can only raise risk, never allow or deny. | none |

Escalations go to an explainable approval card. Every decision is an Ed25519-signed receipt whose hash chains to the
previous one; the head is anchored on a public testnet (`contracts/AuditAnchor.sol`) or locally.

## Results (measured)

Every InjecAgent test case (1,054 attacks; Zhan et al., ACL Findings 2024) replayed through the real engine against a
**fully compromised agent** that always emits the attacker's tool call with arguments copied from the injected text.
This isolates what the shield guarantees on its own, independent of any model. `pnpm eval` reproduces it in ~4 s.

| Configuration | Attack success | False blocks |
|---|---|---|
| No defence | 100% | 0% |
| Provenance only | 9.68% | 0% |
| Intent contract only | 0% | 0% |
| Contract + provenance (no model calls) | **0%** | **0%** |
| **Full AgentShield** | **0%** | **0%** |
| *Stress: attacker's tools inside the contract* | | |
| Contract + provenance | 9.68% (425 escalated to a human) | 0% |
| Full AgentShield | **0%** (425 escalated) | 0% |

- Hidden values traced back to the attacker with de-obfuscation: **918/918 for every method** (base64, hex,
  URL-encoding, homoglyphs, zero-width, spaced letters, spelled-out). Without it: 0% to 28%.
- The heuristic injection detector on its own flags **0%** of InjecAgent's injections, which is why it is advisory only.
- Decision latency: **p50 0.10 ms, p95 0.12 ms** over 11,635 checks.

Honest limits: the replay measures the shield, not a specific model; benign utility is measured on the user's own tool
call; the contract comes from a simulated planner that reads only the user instruction; the causal check relies on
MELON's premise that injected actions don't depend on the user's task.

![Evaluation](docs/screenshot-evaluation.png)

## Quick start

Requires Node 20+ and pnpm. No API keys, Docker or database server needed (SQLite by default).

```bash
pnpm install          # also generates the Prisma client
pnpm dev              # core on :4317, dashboard on :3000
```

Open http://localhost:3000/console, pick a scenario, press **Run side by side**.

| Scenario | Based on | What stops it |
|---|---|---|
| Poisoned GitHub issue | GitHub MCP exploit, Invariant Labs, May 2025 | contract; without it, provenance (private data into a public PR) |
| Support ticket dumps secrets | Supabase MCP leak, General Analysis, Jul 2025 | contract; without it, provenance (SECRET into a PUBLIC reply) |
| Fake bank-details email | business email compromise | escalation with an explainable card |
| Base64-hidden exfiltration | obfuscated injection | contract scope; without it, de-obfuscated provenance |
| Paraphrased phishing broadcast | paraphrase that beats string matching | causal check only |
| Normal task, no attack | utility check | nothing is blocked |

Other commands:

```bash
pnpm test                                      # 33 engine tests + scenario matrix
pnpm eval                                      # InjecAgent replay (data in eval/data, refetch with pnpm eval:fetch)
pnpm --filter @agentshield/mcp-proxy selftest  # MCP proxy end-to-end, incl. rug-pull detection (core must be running)
pnpm --filter @agentshield/sdk selftest        # SDK over HTTP (core must be running)
ANTHROPIC_API_KEY=... npx tsx packages/sdk/examples/llm-agent.ts   # real LLM agent (spends API credits)
```

## Repository

```
packages/core        Express API + engine: contract, provenance, policy, causal check, receipts, scenarios, evaluation
packages/sdk         @agentshield/sdk: Shield.fromRequest(task).wrap(tools) for the Vercel AI SDK or any { execute }
packages/mcp-proxy   MCP proxy for Claude Desktop / Cursor / VS Code, with manifest pinning and tool-poisoning scan
apps/dashboard       Next.js console, approvals, audit chain, evaluation
contracts            AuditAnchor.sol (chain-head anchoring, compiles with solc 0.8.26)
policies             agentshield.rego (OPA policy, mirrors the built-in evaluator)
eval                 InjecAgent data + fetch script
docs                 architecture diagram and screenshots
```

![Architecture](docs/architecture.png)

## Configuration

| Variable | Effect |
|---|---|
| `PORT` | core port (default 4317) |
| `NEXT_PUBLIC_API_URL` | dashboard → core URL (default http://localhost:4317) |
| `DATABASE_URL` | Prisma database (default SQLite in `packages/core/.data`; switch the provider to `postgresql` for Postgres) |
| `OPA_URL` | evaluate policy with Open Policy Agent, e.g. `docker run -p 8181:8181 -v $PWD/policies:/policies openpolicyagent/opa run --server /policies` |
| `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY`, `ANCHOR_CONTRACT` | anchor the chain head on Polygon Amoy instead of locally |
| `ANCHOR_INTERVAL_MS` | anchoring interval (default 5 minutes) |
| `AGENTSHIELD_DATA_DIR` | keys, database and evaluation results (default `.data`) |

## What is simulated

The scenario agents are scripted to follow any instruction they can see, standing in for a fully compromised model,
so demos are deterministic and free. The SDK example runs a real model. The contract compiler is rule-based by default
(it never sees tool output); anchoring is local unless the testnet variables are set; the detector is a heuristic.
In MCP proxy and remote-SDK mode the causal check does not run, because the shield cannot re-query the model there.

## References

Debenedetti et al., AgentDojo (NeurIPS 2024) · Zhan et al., InjecAgent (ACL Findings 2024) · Zhu et al., MELON (ICML 2025) ·
Debenedetti et al., CaMeL (SaTML 2026) · Progent (arXiv 2504.11703) · Nasr, Carlini et al., *The Attacker Moves Second*
(USENIX Security 2026) · Narisetty et al., arXiv 2606.26479 · MCPTox (arXiv 2508.14925) · MCPSecBench (arXiv 2508.13220)
