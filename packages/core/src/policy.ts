// Org policy: tiers, limits and forbidden patterns per agent.
// Evaluated in-process by default. If OPA_URL is set, the same input is sent to
// Open Policy Agent instead (see policies/agentshield.rego).

import type { Tier, ToolSpec } from "./types.js";
import { stringify } from "./provenance.js";
import { display } from "./normalize.js";

export interface AgentPolicy {
  tiers?: Record<string, Tier>;
  limits?: Record<string, Record<string, number>>;          // tool -> numeric arg -> max
  forbidden?: { tool: string; arg?: string; pattern: string; reason: string }[];
  requireApproval?: string[];
}

export interface Policy {
  agents: Record<string, AgentPolicy>;
}

export interface PolicyResult {
  tier: Tier;
  verdict: "DENY" | "ESCALATE" | null;
  reasons: string[];
  engine: "builtin" | "opa";
}

const TIER_ORDER: Tier[] = ["LOW", "MEDIUM", "HIGH", "FORBIDDEN"];
export const maxTier = (a: Tier, b: Tier): Tier => (TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b);
export const raiseTier = (t: Tier): Tier => TIER_ORDER[Math.min(TIER_ORDER.indexOf(t) + 1, 2)] ?? t;

export const DEFAULT_POLICY: Policy = {
  agents: {
    default: {
      limits: { "payments.pay": { amount: 50000 } },
      forbidden: [
        { tool: "shell.exec", arg: "command", pattern: "rm\\s+-rf|mkfs|:\\(\\)\\{|curl[^|]*\\|\\s*(ba)?sh", reason: "destructive or remote-exec shell command" },
        { tool: "db.query", arg: "sql", pattern: "\\b(drop|truncate)\\s+table\\b", reason: "schema-destroying SQL" },
      ],
      requireApproval: ["payments.pay"],
    },
  },
};

/** 48000, "48,000", "₹48,000.50", "INR 48000". Anything else (1e9, 1.000.000, words) is null. */
function parseAmount(s: string): number | null {
  const m = /^\s*(?:[$€£₹]|inr|usd|eur|rs\.?)?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d+)?\s*(?:inr|usd|eur)?\s*$/i.exec(s);
  return m ? Number(m[1].replace(/,/g, "") + (m[2] ?? "")) : null;
}

function evaluateBuiltin(policy: Policy, agentId: string, spec: ToolSpec, args: Record<string, unknown>): PolicyResult {
  const p = { ...policy.agents.default, ...(policy.agents[agentId] ?? {}) };
  let tier = p.tiers?.[spec.name] ?? spec.tier;
  const reasons: string[] = [];
  let verdict: PolicyResult["verdict"] = null;

  for (const f of p.forbidden ?? []) {
    if (f.tool !== spec.name) continue;
    const hay = f.arg ? stringify(args[f.arg]) : stringify(args);
    if (new RegExp(f.pattern, "i").test(hay)) {
      tier = "FORBIDDEN";
      verdict = "DENY";
      reasons.push(`policy: ${f.reason}`);
    }
  }
  for (const [arg, max] of Object.entries(p.limits?.[spec.name] ?? {})) {
    if (args[arg] === undefined || args[arg] === null) continue;
    const n = parseAmount(stringify(args[arg]));
    if (n === null) {
      // "1.000.000", "1e9", "one million": anything we cannot read as a plain number cannot be checked
      verdict = verdict ?? "ESCALATE";
      tier = maxTier(tier, "HIGH");
      reasons.push(`policy: ${arg} "${display(args[arg], 40)}" is not a plain number, so the limit of ${max} cannot be checked`);
    } else if (n > max) {
      verdict = verdict ?? "ESCALATE";
      tier = maxTier(tier, "HIGH");
      reasons.push(`policy: ${arg} ${n} is above the limit of ${max}`);
    }
  }
  if (!verdict && p.requireApproval?.includes(spec.name)) {
    verdict = "ESCALATE";
    reasons.push(`policy: ${spec.name} always needs a human`);
  }
  return { tier, verdict, reasons, engine: "builtin" };
}

export async function evaluatePolicy(policy: Policy, agentId: string, spec: ToolSpec,
  args: Record<string, unknown>): Promise<PolicyResult> {
  const url = process.env.OPA_URL;
  if (url) {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/v1/data/agentshield/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { agent: agentId, tool: spec.name, tier: spec.tier, args } }),
      });
      const { result } = (await res.json()) as { result?: { verdict?: string; tier?: Tier; reasons?: string[] } };
      if (result) {
        return {
          tier: result.tier ?? spec.tier,
          verdict: result.verdict === "DENY" || result.verdict === "ESCALATE" ? result.verdict : null,
          reasons: result.reasons ?? [],
          engine: "opa",
        };
      }
    } catch {
      // fall through to the built-in evaluator so the shield never fails open
    }
  }
  return evaluateBuiltin(policy, agentId, spec, args);
}
