import { randomUUID } from "node:crypto";
import type {
  ArgLabel, CausalResult, Confidentiality, Decision, IntentContract, LayerResult, ShieldSettings,
  Tier, ToolCall, ToolSpec, Verdict, Visibility,
} from "./types.js";
import { CONF_RANK, PRESETS, VIS_RANK } from "./types.js";
import { checkContract, compileContract, issueContract, widenContract } from "./contract.js";
import { LabelStore, stringify } from "./provenance.js";
import { DEFAULT_POLICY, evaluatePolicy, maxTier, raiseTier, type Policy } from "./policy.js";
import { injectionScore } from "./detector.js";
import { causalCheck, type ReplayFn } from "./causal.js";
import { requestApproval } from "./approvals.js";
import { appendReceipt } from "./receipts.js";
import { bus } from "./events.js";

export interface Session {
  id: string;
  agentId: string;
  task: string;
  contract: IntentContract;
  store: LabelStore;
  settings: ShieldSettings;
  maxInjection: number;
  decisions: { call: ToolCall; decision: Decision }[];
}

export interface CheckOptions {
  replay?: ReplayFn;
  /** "wait" asks a human; "return" hands ESCALATE back to the caller (used by the evaluation) */
  escalation?: "wait" | "return";
  /** decide escalations without the approval queue (tests, CLI, unattended demos) */
  review?: (d: Decision, call: ToolCall) => boolean | Promise<boolean>;
  record?: boolean;
}

export class Shield {
  readonly tools = new Map<string, ToolSpec>();
  readonly sessions = new Map<string, Session>();

  constructor(tools: ToolSpec[] = [], public policy: Policy = DEFAULT_POLICY) {
    for (const t of tools) this.tools.set(t.name, t);
  }

  registerTools(tools: ToolSpec[]) {
    for (const t of tools) this.tools.set(t.name, t);
  }

  /**
   * Step 1-2: the request is compiled into a signed contract before the agent reads anything.
   * Only the user's task (trusted) is visible to the compiler.
   */
  startSession(opts: { task: string; agentId?: string; settings?: Partial<ShieldSettings>; tools?: string[];
    contract?: IntentContract; systemPrompt?: string }): Session {
    const id = randomUUID();
    const settings = { ...PRESETS.balanced, ...(opts.settings ?? {}) };
    const scope = opts.tools ? opts.tools.map((n) => this.tools.get(n)!).filter(Boolean) : [...this.tools.values()];
    const contract = opts.contract ?? compileContract(id, opts.task, scope);
    const store = new LabelStore(settings.deobfuscate);
    store.add("user request", opts.task, "TRUSTED", "PUBLIC");
    if (opts.systemPrompt) store.add("system prompt", opts.systemPrompt, "TRUSTED", "PUBLIC");
    const s: Session = { id, agentId: opts.agentId ?? "default", task: opts.task, contract, store, settings,
      maxInjection: 0, decisions: [] };
    this.sessions.set(id, s);
    bus.emit("session", { id, agentId: s.agentId, task: s.task, contract });
    return s;
  }

  session(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`unknown session ${id}`);
    return s;
  }

  /** Step 10: every tool result is labelled before the agent sees it. */
  async recordResult(sessionId: string, call: ToolCall, output: unknown) {
    const s = this.session(sessionId);
    const spec = this.tools.get(call.tool);
    const text = stringify(output);
    const conf: Confidentiality = typeof spec?.outputConfidentiality === "function"
      ? spec.outputConfidentiality(call.args)
      : spec?.outputConfidentiality ?? "PRIVATE";
    const integrity = spec?.outputIntegrity ?? "UNTRUSTED";
    s.store.add(`${call.tool}#${call.id}`, text, integrity, conf);
    if (s.settings.detector && integrity === "UNTRUSTED") {
      s.maxInjection = Math.max(s.maxInjection, await injectionScore(text));
    }
  }

  /** Steps 3-9: decide one tool call. */
  async check(sessionId: string, call: ToolCall, opts: CheckOptions = {}): Promise<Decision> {
    const t0 = performance.now();
    const s = this.session(sessionId);
    const st = s.settings;
    const spec = this.tools.get(call.tool);
    const layers: LayerResult[] = [];
    const reasons: string[] = [];
    let labels: ArgLabel[] = [];
    let verdict: Verdict | null = null;
    let risk: Tier = spec?.tier ?? "HIGH";
    let causal: CausalResult | undefined;

    const finish = async (v: Verdict): Promise<Decision> => {
      const d: Decision = {
        verdict: v, risk, reasons, labels, layers, injectionScore: s.maxInjection, causal,
        latencyMs: Number((performance.now() - t0).toFixed(3)),
      };
      return this.conclude(s, call, d, opts);
    };

    if (!spec) {
      reasons.push(`unknown tool ${call.tool}`);
      return finish("DENY");
    }

    // ---- layer 1: intent contract
    if (st.contract) {
      const c = checkContract(s.contract, call.tool, call.args);
      layers.push({ layer: "contract", outcome: c.ok ? "pass" : "block", detail: c.detail });
      if (!c.ok) {
        reasons.push(`contract: ${c.detail}`);
        verdict = "DENY";
      }
    } else {
      layers.push({ layer: "contract", outcome: "skip", detail: "contract layer off" });
    }

    // ---- layer 2: argument provenance
    let taintedControl: ArgLabel[] = [];
    let unknownControl = false;
    if (st.provenance && !verdict) {
      s.store.setDeep(st.deobfuscate);
      labels = Object.entries(call.args).map(([k, v]) => s.store.label(k, v));
      const control = new Set(spec.controlArgs ?? []);
      taintedControl = labels.filter((l) => control.has(l.arg) && l.integrity === "UNTRUSTED");
      unknownControl = labels.some((l) => control.has(l.arg) && l.sources.length === 0
        && stringify(call.args[l.arg]).trim().length >= 4);
      const leaks: string[] = [];
      for (const [arg, vis] of Object.entries(spec.sinkArgs ?? {})) {
        const visibility: Visibility = typeof vis === "function" ? vis(call.args) : vis;
        const l = labels.find((x) => x.arg === arg);
        if (l && CONF_RANK[l.confidentiality] > VIS_RANK[visibility]) {
          leaks.push(`${l.confidentiality} data from ${l.sources.join(", ")} into a ${visibility} sink (${arg})`);
        }
      }
      const taintMsg = taintedControl.map((l) => `'${l.arg}' came from ${l.sources.join(", ")}${l.via && l.via !== "plain" ? ` (decoded via ${l.via})` : ""}`).join("; ");
      const writeTaint = taintedControl.length > 0 && spec.effect === "write";
      if (leaks.length || writeTaint) {
        // The user asked for this action but its target came from untrusted text: a human should look.
        // Outside the contract, with the contract layer off, or when data would leak, it is denied.
        const inContract = st.contract && s.contract.allow.some((r) => r.tool === call.tool);
        verdict = leaks.length || !inContract ? "DENY" : "ESCALATE";
        risk = maxTier(risk, "HIGH");
        const detail = [...leaks, ...(writeTaint ? [taintMsg] : [])].join("; ");
        layers.push({ layer: "provenance", outcome: verdict === "DENY" ? "block" : "flag", detail });
        reasons.push(...leaks.map((x) => `provenance: ${x}`), ...(writeTaint ? [`provenance: ${taintMsg}`] : []));
      } else if (taintedControl.length) {
        risk = maxTier(risk, "MEDIUM");
        layers.push({ layer: "provenance", outcome: "flag", detail: `read with untrusted arguments: ${taintMsg}` });
      } else {
        layers.push({ layer: "provenance", outcome: "pass", detail: labels.length ? "all arguments trace to trusted sources or are model-generated" : "no arguments" });
      }
    } else if (!st.provenance) {
      layers.push({ layer: "provenance", outcome: "skip", detail: "provenance layer off" });
    }

    // ---- advisory detector: can only raise risk
    if (st.detector) {
      const high = s.maxInjection >= 0.5;
      layers.push({ layer: "detector", outcome: high ? "flag" : "pass", detail: `max injection score in untrusted content: ${s.maxInjection}` });
      if (high && spec.effect === "write") risk = raiseTier(risk);
    }

    // ---- layer 3: policy and risk tier
    if (verdict !== "DENY") {
      const p = await evaluatePolicy(this.policy, s.agentId, spec, call.args);
      risk = maxTier(risk, p.tier);
      if (p.verdict === "DENY") verdict = "DENY";
      else if (p.verdict === "ESCALATE" && !verdict) verdict = "ESCALATE";
      reasons.push(...p.reasons);
      layers.push({ layer: "policy", outcome: p.verdict === "DENY" ? "block" : p.verdict ? "flag" : "pass",
        detail: p.reasons.join("; ") || `tier ${p.tier} (${p.engine})` });
    }

    // ---- layer 4: causal check, only for high-risk writes the rules could not settle
    const inconclusive = !taintedControl.length && s.store.hasUntrusted && spec.effect === "write"
      && (risk === "HIGH" || unknownControl);
    if (st.causal && verdict !== "DENY" && inconclusive) {
      causal = await causalCheck(spec, call, opts.replay, st.causalThreshold);
      if (causal.ran && causal.injectionDriven) {
        verdict = "DENY";
        reasons.push(`causal: ${causal.note}`);
        layers.push({ layer: "causal", outcome: "block", detail: causal.note });
      } else {
        layers.push({ layer: "causal", outcome: causal.ran ? "pass" : "skip", detail: causal.note });
      }
    } else {
      layers.push({ layer: "causal", outcome: "skip", detail: st.causal ? "not needed: rules were conclusive" : "causal layer off" });
    }

    if (!verdict && st.escalateHighAfterUntrusted && risk === "HIGH" && s.store.hasUntrusted && spec.effect === "write") {
      verdict = "ESCALATE";
      reasons.push("strict mode: high-risk write after reading untrusted content");
    }
    return finish(verdict ?? "ALLOW");
  }

  private async conclude(s: Session, call: ToolCall, d: Decision, opts: CheckOptions): Promise<Decision> {
    let final = d;
    let reviewer: string | null = null;
    if (d.verdict === "ESCALATE" && opts.escalation !== "return") {
      bus.emit("decision", { sessionId: s.id, call, decision: d, pending: true });
      const outcome = opts.review
        ? { approved: await opts.review(d, call), by: "human" as const, note: "auto-review" }
        : await requestApproval({
        sessionId: s.id, agentId: s.agentId, task: s.task, tool: call.tool, args: call.args,
        reasons: d.reasons, labels: d.labels, causal: d.causal ?? null,
        focus: this.tools.get(call.tool)?.controlArgs ?? [],
        recommended: d.labels.some((l) => l.integrity === "UNTRUSTED" && (this.tools.get(call.tool)?.controlArgs ?? []).includes(l.arg)) ? "deny" : "approve",
      }, s.settings.approvalTimeoutMs);
      reviewer = outcome.by === "timeout" ? "timeout" : `human: ${outcome.approved ? "approved" : "denied"}`;
      final = { ...d, verdict: outcome.approved ? "ALLOW" : "DENY",
        reasons: [...d.reasons, `reviewer: ${outcome.by === "timeout" ? "no decision before timeout" : outcome.approved ? "approved" : "denied"}${outcome.note ? ` (${outcome.note})` : ""}`] };
    }
    s.decisions.push({ call, decision: final });
    if (opts.record !== false) {
      await appendReceipt({
        sessionId: s.id, agentId: s.agentId, tool: call.tool, args: call.args, verdict: final.verdict,
        risk: final.risk, reasons: final.reasons, labels: final.labels, reviewer, at: new Date().toISOString(),
      });
      bus.emit("decision", { sessionId: s.id, call, decision: final, escalated: d.verdict === "ESCALATE", reviewer });
    }
    return final;
  }

  /** Widening the contract always goes through a human; the result is a new signed contract. */
  widen(sessionId: string, tool: string) {
    const s = this.session(sessionId);
    s.contract = widenContract(s.contract, { tool });
    return s.contract;
  }

  /** Issue a contract directly (used by the evaluation's simulated planner). */
  static contractFor(sessionId: string, task: string, tools: string[]) {
    return issueContract(sessionId, task, tools.map((tool) => ({ tool })));
  }
}
