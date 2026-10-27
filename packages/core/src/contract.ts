// Intent contracts: compile the user's request (and nothing else) into a signed,
// frozen allow-list of actions before the agent reads any untrusted content.

import { randomUUID } from "node:crypto";
import type { ContractRule, IntentContract, ToolSpec } from "./types.js";
import { canonical, display } from "./normalize.js";
import { signPayload, verifyPayload } from "./crypto.js";

const SCOPE_PATTERNS: Record<string, RegExp> = {
  repo: /\b[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*\b/g,
  channel: /#[a-z0-9][a-z0-9_-]*/g,
  to: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g,
  ticket_id: /\bt-\d+\b/g,
};

function hasWord(text: string, kw: string): boolean {
  const k = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${k}(s|es|ed|ing)?([^a-z0-9]|$)`).test(text);
}

/**
 * Deterministic compiler. It only ever sees the user's request and the tool catalogue.
 * A tool is granted when the request mentions one of its keywords. Writes need an
 * explicit action word; reads may also come along with an app the request names.
 * Scope arguments are pinned to values that appear in the request.
 */
export function compileRules(task: string, tools: ToolSpec[]): ContractRule[] {
  const t = canonical(task);
  const named = new Set(tools.map((x) => x.app).filter((app) => hasWord(t, app)));
  const rules: ContractRule[] = [];
  for (const tool of tools) {
    const keywordHit = tool.keywords.some((k) => hasWord(t, k));
    const granted = tool.effect === "write" ? keywordHit : keywordHit || named.has(tool.app);
    if (!granted) continue;
    const rule: ContractRule = { tool: tool.name };
    if (tool.scopeArg && SCOPE_PATTERNS[tool.scopeArg]) {
      const values = [...new Set(t.match(SCOPE_PATTERNS[tool.scopeArg]) ?? [])];
      if (values.length) rule.scope = { arg: tool.scopeArg, values };
    }
    rules.push(rule);
  }
  return rules;
}

export function issueContract(sessionId: string, task: string, allow: ContractRule[],
  compiler: IntentContract["compiler"] = "rules", ttlMs = 60 * 60 * 1000): IntentContract {
  const now = Date.now();
  const body = {
    id: randomUUID(),
    sessionId,
    task,
    allow,
    default: "deny" as const,
    compiler,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  return { ...body, signature: signPayload(body) };
}

export function compileContract(sessionId: string, task: string, tools: ToolSpec[]): IntentContract {
  return issueContract(sessionId, task, compileRules(task, tools));
}

export function verifyContract(c: IntentContract): boolean {
  const { signature, ...body } = c;
  return verifyPayload(body, signature) && Date.parse(c.expiresAt) > Date.now();
}

export interface ContractCheck {
  ok: boolean;
  detail: string;
}

export function checkContract(c: IntentContract, tool: string, args: Record<string, unknown>): ContractCheck {
  if (!verifyContract(c)) return { ok: false, detail: "contract signature invalid or expired" };
  const rule = c.allow.find((r) => r.tool === tool);
  if (!rule) return { ok: false, detail: `${tool} is not part of the task "${c.task}"` };
  if (rule.scope) {
    // The tool receives the raw value, so it is compared as written: only ASCII case is folded. Unicode
    // folding here would let a lookalike ("acme/websіte", "bоb@acme.com") pass as the repo or recipient the
    // user named while the tool resolves a different one.
    const v = String(args[rule.scope.arg] ?? "").replace(/[A-Z]/g, (c) => c.toLowerCase());
    if (!rule.scope.values.includes(v)) {
      return { ok: false, detail: `${rule.scope.arg} "${display(args[rule.scope.arg])}" is outside the contract (allowed: ${rule.scope.values.join(", ")})` };
    }
  }
  return { ok: true, detail: rule.scope ? `allowed on ${rule.scope.values.join(", ")}` : "allowed by contract" };
}

/** Narrow-only update: returns a new signed contract that is a subset of the old one. */
export function narrowContract(c: IntentContract, keep: (r: ContractRule) => boolean): IntentContract {
  return issueContract(c.sessionId, c.task, c.allow.filter(keep), c.compiler);
}

/** Widening is only possible through a human approval, recorded as a new signed contract. */
export function widenContract(c: IntentContract, rule: ContractRule): IntentContract {
  return issueContract(c.sessionId, c.task, [...c.allow.filter((r) => r.tool !== rule.tool), rule], c.compiler);
}
