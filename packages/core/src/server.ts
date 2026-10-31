import "./env.js";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Shield } from "./engine.js";
import { PRESETS, type ShieldSettings, type ToolSpec } from "./types.js";
import { SCENARIOS, scenario, allScenarioTools } from "./scenarios/index.js";
import { runScenario, runs, type RunResult } from "./runner.js";
import { bus } from "./events.js";
import { decide, denialMemory, forgetDenials, pendingApprovals, setDenialMemory } from "./approvals.js";
import { anchorHead, startAnchorLoop, verifyChain, rewriteHistory } from "./receipts.js";
import { db } from "./db.js";
import { DATA_DIR, sha256, signingKey } from "./crypto.js";
import { compileRules } from "./contract.js";
import { currentDetector, heuristicScore, injectionScore, setDetector } from "./detector.js";
import { loadPromptGuard, promptGuardScore } from "./promptguard.js";
import { runInjecAgentEval } from "./eval/injecagent.js";
import { runAdaptiveEval } from "./eval/adaptive.js";
import { registerLive } from "./live.js";

const PORT = Number(process.env.PORT ?? 4317);
const shield = new Shield(allScenarioTools());
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const presetName = z.enum(["strict", "balanced", "permissive", "off"]);
const settingsSchema = z.object({
  contract: z.boolean(), provenance: z.boolean(), deobfuscate: z.boolean(), causal: z.boolean(),
  detector: z.boolean(), escalateHighAfterUntrusted: z.boolean(), approvalTimeoutMs: z.number().int().min(5_000).max(600_000),
  causalThreshold: z.number().min(0.1).max(0.95), flagUntraced: z.boolean(),
}).partial();

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => async (req: Request, res: Response) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    const err = e as Error;
    res.status(err instanceof z.ZodError ? 400 : 500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------- meta
app.get("/api/health", wrap(() => ({
  ok: true, version: "0.1.0", detector: currentDetector(), policyEngine: process.env.OPA_URL ? "opa" : "builtin",
  anchor: process.env.ANCHOR_RPC_URL ? "polygon-amoy" : "local", publicKey: signingKey().publicPem,
})));
app.get("/api/presets", wrap(() => PRESETS));
app.get("/api/scenarios", wrap(() => SCENARIOS.map((s) => ({
  id: s.id, title: s.title, tagline: s.tagline, basedOn: s.basedOn, task: s.task, attack: s.attack, tryThis: s.tryThis,
  tools: s.tools.map((t) => ({ name: t.spec.name, effect: t.spec.effect, tier: t.spec.tier, description: t.spec.description })),
  contractPreview: compileRules(s.task, s.tools.map((t) => t.spec)),
}))));

// ---------------------------------------------------------------- live events (Server-Sent Events)
app.get("/api/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const names = ["decision", "approval", "receipt", "anchor", "run", "run-step", "session"];
  const handlers = names.map((n) => {
    const h = (data: unknown) => res.write(`event: ${n}\ndata: ${JSON.stringify(data)}\n\n`);
    bus.on(n, h);
    return [n, h] as const;
  });
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(ping);
    for (const [n, h] of handlers) bus.off(n, h);
  });
});

// ---------------------------------------------------------------- scenario runs
app.post("/api/runs", wrap(async (req) => {
  const body = z.object({
    scenarioId: z.string(),
    mode: z.enum(["protected", "unprotected", "both"]).default("both"),
    preset: presetName.default("balanced"),
    overrides: settingsSchema.optional(),
  }).parse(req.body);
  const sc = scenario(body.scenarioId);
  const settings: ShieldSettings = { ...PRESETS[body.preset], ...(body.overrides ?? {}) };
  const modes: RunResult["mode"][] = body.mode === "both" ? ["unprotected", "protected"] : [body.mode];
  const ids = modes.map((m) => {
    const id = crypto.randomUUID();
    void runScenario(shield, sc, m, settings, body.preset, id);
    return { mode: m, id };
  });
  return { runs: ids };
}));
app.get("/api/runs", wrap(() => [...runs.values()].reverse().slice(0, 30)));
app.get("/api/runs/:id", wrap((req, res) => {
  const r = runs.get(String(req.params.id));
  if (!r) return res.status(404).json({ error: "not found" });
  return r;
}));

// ---------------------------------------------------------------- live agent (real model)
registerLive(app);

// ---------------------------------------------------------------- approvals
app.get("/api/approvals", wrap(() => pendingApprovals()));
// denial memory: approvals are one-off, denials are remembered (switchable for demos)
app.get("/api/approvals/memory", wrap(() => denialMemory()));
app.put("/api/approvals/memory", wrap((req) => {
  setDenialMemory(z.object({ enabled: z.boolean() }).parse(req.body).enabled);
  return denialMemory();
}));
app.delete("/api/approvals/memory", wrap(() => { forgetDenials(); return denialMemory(); }));
app.get("/api/approvals/history", wrap(async () => {
  const rows = await db.approval.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  return rows.map((r) => ({ ...r, args: JSON.parse(r.args), reasons: JSON.parse(r.reasons), context: JSON.parse(r.context) }));
}));
app.post("/api/approvals/:id", wrap(async (req, res) => {
  const body = z.object({ approve: z.boolean(), note: z.string().max(500).optional() }).parse(req.body);
  const ok = await decide(String(req.params.id), body.approve, "human", body.note);
  if (!ok) return res.status(404).json({ error: "no pending approval with that id" });
  return { ok };
}));

// ---------------------------------------------------------------- receipts and anchoring
app.get("/api/receipts", wrap(async (req) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const rows = await db.receipt.findMany({ orderBy: { seq: "desc" }, take: limit });
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}));
app.get("/api/receipts/verify", wrap(() => verifyChain()));
app.get("/api/anchors", wrap(() => db.anchor.findMany({ orderBy: { id: "desc" }, take: 20 })));
app.post("/api/anchor", wrap(() => anchorHead()));

// Demo only: alter one stored receipt so the verifier can be shown catching it, then put it back.
const tampered = new Map<number, string>();
app.post("/api/demo/tamper", wrap(async (_req, res) => {
  const rows = await db.receipt.findMany({ orderBy: { seq: "asc" } });
  const target = rows.find((r) => r.verdict === "DENY") ?? rows[0];
  if (!target) return res.status(400).json({ error: "no receipts yet: run a scenario first" });
  if (!tampered.has(target.seq)) tampered.set(target.seq, target.payload);
  const edited = target.payload.replace(/"verdict":"DENY"/, '"verdict":"ALLOW"');
  await db.receipt.update({ where: { seq: target.seq }, data: { payload: edited === target.payload ? `${edited} ` : edited } });
  return { seq: target.seq, change: "verdict DENY changed to ALLOW in the stored payload" };
}));
// Demo only: edit a receipt AND recompute every later hash and signature, so a database-only check passes.
type RewriteBackup = { seq: number; payload: string; prevHash: string; hash: string; signature: string }[];
let rewritten: RewriteBackup | null = null;
const backupFile = join(DATA_DIR, "demo-backup.json");
function saveDemoBackup(b: { rewritten: RewriteBackup | null }) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(backupFile, JSON.stringify(b));
}
function loadDemoBackup(): { rewritten: RewriteBackup | null } {
  try { return existsSync(backupFile) ? JSON.parse(readFileSync(backupFile, "utf8")) : { rewritten: null }; } catch { return { rewritten: null }; }
}
app.post("/api/demo/rewrite", wrap(async (_req, res) => {
  if (rewritten ?? loadDemoBackup().rewritten) return res.status(400).json({ error: "history already rewritten: restore first" });
  const r = await rewriteHistory();
  if (!r) return res.status(400).json({ error: "no receipts yet: run a scenario first" });
  rewritten = r.backup;
  saveDemoBackup({ rewritten: r.backup });
  return { seq: r.seq, rewritten: r.rewritten, change: "verdict DENY changed to ALLOW and all later hashes recomputed" };
}));
app.post("/api/demo/restore", wrap(async () => {
  // the backup is also on disk, so Restore still works after the core restarted mid-demo
  const saved = loadDemoBackup();
  for (const [seq, payload] of tampered) await db.receipt.update({ where: { seq }, data: { payload } });
  let n = tampered.size;
  tampered.clear();
  const rw = rewritten ?? saved.rewritten;
  if (rw) {
    for (const b of rw) await db.receipt.update({ where: { seq: b.seq }, data: { payload: b.payload, prevHash: b.prevHash, hash: b.hash, signature: b.signature } });
    n += rw.length;
    rewritten = null;
  }
  // a single-entry edit flips a DENY payload to ALLOW; undo it only when the result matches the signed hash
  for (const row of await db.receipt.findMany({ where: { verdict: "DENY" } })) {
    if (!row.payload.includes('"verdict":"ALLOW"')) continue;
    const original = row.payload.replace(/"verdict":"ALLOW"/, '"verdict":"DENY"').replace(/ $/, "");
    if (sha256(row.prevHash + original) === row.hash) {
      await db.receipt.update({ where: { seq: row.seq }, data: { payload: original } });
      n++;
    }
  }
  saveDemoBackup({ rewritten: null });
  return { restored: n };
}));

// ---------------------------------------------------------------- stats
app.get("/api/stats", wrap(async () => {
  const grouped = await db.receipt.groupBy({ by: ["verdict"], _count: true });
  const count = (v: string) => grouped.find((g) => g.verdict === v)?._count ?? 0;
  const done = [...runs.values()].filter((r) => r.status === "done");
  const prot = done.filter((r) => r.mode === "protected");
  const unprot = done.filter((r) => r.mode === "unprotected");
  return {
    decisions: count("ALLOW") + count("DENY"),
    allowed: count("ALLOW"),
    denied: count("DENY"),
    escalationsPending: pendingApprovals().length,
    approvalsTotal: await db.approval.count(),
    runs: done.length,
    harmProtected: prot.filter((r) => r.harm).length,
    harmUnprotected: unprot.filter((r) => r.harm).length,
    protectedRuns: prot.length,
    unprotectedRuns: unprot.length,
  };
}));

// ---------------------------------------------------------------- evaluation
const evalFile = join(DATA_DIR, "eval-results.json");
app.get("/api/eval", wrap(() => (existsSync(evalFile) ? JSON.parse(readFileSync(evalFile, "utf8")) : null)));
const adaptiveFile = join(DATA_DIR, "adaptive-results.json");
app.get("/api/eval/adaptive", wrap(() => (existsSync(adaptiveFile) ? JSON.parse(readFileSync(adaptiveFile, "utf8")) : null)));
app.post("/api/eval/adaptive", wrap(async () => {
  const report = await runAdaptiveEval();
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(adaptiveFile, JSON.stringify(report, null, 2));
  return report;
}));
// real-model runs (pnpm eval:llm); per-case results are stripped to keep the response small
app.get("/api/eval/llm", wrap(() => {
  const load = (setting: string) => {
    const f = join(DATA_DIR, `eval-llm-${setting}.json`);
    if (!existsSync(f)) return null;
    const { results, ...summary } = JSON.parse(readFileSync(f, "utf8"));
    return summary;
  };
  return { base: load("base"), enhanced: load("enhanced") };
}));
app.post("/api/eval", wrap(async () => {
  const report = await runInjecAgentEval();
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(evalFile, JSON.stringify(report, null, 2));
  return report;
}));

// ---------------------------------------------------------------- SDK / MCP proxy API
const toolSpecSchema = z.object({
  name: z.string(), app: z.string(), description: z.string().default(""),
  effect: z.enum(["read", "write"]), tier: z.enum(["LOW", "MEDIUM", "HIGH", "FORBIDDEN"]),
  keywords: z.array(z.string()).default([]), scopeArg: z.string().optional(), controlArgs: z.array(z.string()).optional(),
  sinkArgs: z.record(z.string(), z.enum(["PUBLIC", "PRIVATE", "INTERNAL"])).optional(),
  outputIntegrity: z.enum(["TRUSTED", "UNTRUSTED"]).optional(),
  outputConfidentiality: z.enum(["PUBLIC", "PRIVATE", "SECRET"]).optional(),
  params: z.record(z.string(), z.string()).default({}),
});
app.post("/v1/tools", wrap((req) => {
  const tools = z.object({ tools: z.array(toolSpecSchema) }).parse(req.body).tools as ToolSpec[];
  shield.registerTools(tools);
  return { registered: tools.map((t) => t.name) };
}));
app.post("/v1/sessions", wrap((req) => {
  const b = z.object({
    task: z.string().min(1), agentId: z.string().optional(), tools: z.array(z.string()).optional(),
    preset: presetName.optional(), settings: settingsSchema.optional(), systemPrompt: z.string().optional(),
  }).parse(req.body);
  const s = shield.startSession({ task: b.task, agentId: b.agentId, tools: b.tools, systemPrompt: b.systemPrompt,
    settings: { ...PRESETS[b.preset ?? "balanced"], flagUntraced: true, ...(b.settings ?? {}) } });
  return { sessionId: s.id, contract: s.contract };
}));
app.post("/v1/check", wrap(async (req) => {
  const b = z.object({ sessionId: z.string(), call: z.object({ id: z.string().default(() => crypto.randomUUID()), tool: z.string(), args: z.record(z.string(), z.unknown()).default({}) }) }).parse(req.body);
  return shield.check(b.sessionId, b.call);
}));
app.post("/v1/scan", wrap(async (req) => {
  const b = z.object({ text: z.string().max(100_000) }).parse(req.body);
  return { score: await injectionScore(b.text), detector: currentDetector() };
}));
app.post("/v1/result", wrap(async (req) => {
  const b = z.object({ sessionId: z.string(), call: z.object({ id: z.string(), tool: z.string(), args: z.record(z.string(), z.unknown()).default({}) }), output: z.unknown() }).parse(req.body);
  await shield.recordResult(b.sessionId, b.call, b.output);
  return { ok: true };
}));

app.listen(PORT, () => {
  startAnchorLoop();
  console.log(`AgentShield core listening on http://localhost:${PORT}`);
  // the ML detector, if its model is on disk; it adds to the heuristic score and stays advisory
  loadPromptGuard().then((ok) => {
    if (!ok) return console.log("detector: heuristic (run `pnpm --filter @agentshield/core model:fetch` for Prompt Guard 2)");
    setDetector(async (t) => Math.max(heuristicScore(t), await promptGuardScore(t)), "prompt-guard-2-86m+heuristic");
    console.log("detector: Prompt Guard 2 (86M) + heuristic");
  }).catch((e) => console.log(`detector: heuristic (Prompt Guard failed to load: ${(e as Error).message})`));
});
