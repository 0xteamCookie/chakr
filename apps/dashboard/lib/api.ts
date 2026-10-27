"use client";

import { useEffect, useRef, useState } from "react";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4317";

export type Verdict = "ALLOW" | "ESCALATE" | "DENY";
export type Tier = "LOW" | "MEDIUM" | "HIGH" | "FORBIDDEN";

export interface ArgLabel {
  arg: string;
  integrity: "TRUSTED" | "UNTRUSTED";
  confidentiality: "PUBLIC" | "PRIVATE" | "SECRET";
  sources: string[];
  via?: string;
}
export interface LayerResult { layer: string; outcome: "pass" | "flag" | "block" | "skip"; detail: string }
export interface CausalResult { ran: boolean; injectionDriven: boolean; similarity: number; note: string; replayedCall?: { tool: string; args: Record<string, unknown> } | null }
export interface Decision {
  verdict: Verdict; risk: Tier; reasons: string[]; labels: ArgLabel[]; layers: LayerResult[];
  injectionScore: number; causal?: CausalResult; latencyMs: number;
}
export interface ToolCall { id: string; tool: string; args: Record<string, unknown> }
export interface RunStep { index: number; call: ToolCall; executed: boolean; decision: Decision | null; output: string }
export interface ContractRule { tool: string; scope?: { arg: string; values: string[] } }
export interface IntentContract { id: string; task: string; allow: ContractRule[]; compiler: string; issuedAt: string; expiresAt: string; signature: string }
export interface Run {
  id: string; scenarioId: string; mode: "protected" | "unprotected"; preset: string; task: string;
  contract: IntentContract | null; steps: RunStep[]; harm: string | null; completed: boolean;
  status: "running" | "done" | "error"; error?: string; startedAt: string; finishedAt?: string;
}
export interface Scenario {
  id: string; title: string; tagline: string; basedOn: string; task: string; attack: boolean; tryThis: string;
  tools: { name: string; effect: string; tier: Tier; description: string }[];
  contractPreview: ContractRule[];
}
export interface Approval {
  id: string; sessionId: string; agentId: string; task: string; tool: string; args: Record<string, unknown>;
  reasons: string[]; labels: ArgLabel[]; focus: string[]; causal: CausalResult | null; recommended: "approve" | "deny";
  createdAt: string; expiresAt: string; status: string;
}
export interface Settings {
  contract: boolean; provenance: boolean; deobfuscate: boolean; causal: boolean; detector: boolean;
  escalateHighAfterUntrusted: boolean; approvalTimeoutMs: number; causalThreshold: number;
}
export interface Stats {
  decisions: number; allowed: number; denied: number; escalationsPending: number; approvalsTotal: number;
  runs: number; harmProtected: number; harmUnprotected: number; protectedRuns: number; unprotectedRuns: number;
}
export interface Receipt {
  seq: number; sessionId: string; tool: string; verdict: string; prevHash: string; hash: string; signature: string; createdAt: string;
  payload: { agentId: string; args: Record<string, unknown>; reasons: string[]; risk: string; reviewer?: string | null; at: string };
}
export interface VerifyReport {
  ok: boolean; count: number; head: string; brokenAt: number | null; problem: string | null;
  anchor: { seq: number; head: string; network: string; txHash: string | null; matches: boolean } | null;
  onchain?: { status: "ok" | "unreachable" | "empty"; network?: string; contract?: string; seq?: number; head?: string; matches?: boolean; explorerUrl?: string; error?: string };
}
export interface ConfigResult {
  key: string; label: string; description: string; attacks: number; executed: number; escalated: number; denied: number;
  asr: number; benignCalls: number; benignBlocked: number; falseBlockRate: number; byLayer: Record<string, number>;
}
export interface EvalReport {
  dataset: string; cases: { total: number; directHarm: number; dataStealing: number }; threatModel: string;
  configs: ConfigResult[]; stress: ConfigResult[];
  obfuscation: { method: string; cases: number; tracedWith: number; tracedWithout: number }[];
  detector: { flagged: number; total: number; rate: number };
  latency: { p50: number; p95: number; max: number; checks: number }; generatedAt: string; durationMs: number;
}

export interface AdaptiveReport {
  threatModel: string;
  categories: { category: string; variants: number; blocked: number; escalated: number; executed: number; misled: number; succeeded: string[]; deterministicExecuted: number }[];
  variants: { id: string; category: string; name: string; outcome: string; deterministic: string; layer: string; misled: string | null; success: boolean; known?: string }[];
  bypasses: string[]; known: { id: string; issue: string }[]; generatedAt: string; durationMs: number;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? res.statusText);
  return body as T;
}

export const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });

/** Polls an endpoint and re-fetches immediately when any of the given server events arrive. */
export function useLive<T>(path: string, events: string[], intervalMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tick = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = () => api<T>(path).then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e: Error) => alive && setError(e.message));
    load();
    const t = setInterval(load, intervalMs);
    const unsub = subscribe(events, () => {
      const mine = ++tick.current;
      setTimeout(() => mine === tick.current && load(), 120);
    });
    return () => { alive = false; clearInterval(t); unsub(); };
  }, [path, events.join(","), intervalMs]);
  return { data, error, reload: () => api<T>(path).then(setData) };
}

let source: EventSource | null = null;
const listeners = new Map<string, Set<(d: unknown) => void>>();

export function subscribe(events: string[], fn: (d: unknown, ev: string) => void) {
  if (typeof window === "undefined") return () => {};
  if (!source) {
    source = new EventSource(`${API}/api/events`);
  }
  const bound: [string, (e: MessageEvent) => void][] = events.map((ev) => {
    const h = (e: MessageEvent) => fn(JSON.parse(e.data), ev);
    source!.addEventListener(ev, h as EventListener);
    return [ev, h];
  });
  return () => { for (const [ev, h] of bound) source?.removeEventListener(ev, h as EventListener); };
}

export const short = (h: string, n = 6) => (h.length > 2 * n ? `${h.slice(0, n)}..${h.slice(-4)}` : h);
export const fmtArgs = (a: Record<string, unknown>) =>
  Object.entries(a).map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v.length > 48 ? v.slice(0, 48) + "…" : v) : JSON.stringify(v)}`).join(", ");
