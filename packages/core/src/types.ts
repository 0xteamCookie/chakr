export type Verdict = "ALLOW" | "ESCALATE" | "DENY";
export type Tier = "LOW" | "MEDIUM" | "HIGH" | "FORBIDDEN";
export type Integrity = "TRUSTED" | "UNTRUSTED";
export type Confidentiality = "PUBLIC" | "PRIVATE" | "SECRET";
export type Visibility = "PUBLIC" | "PRIVATE" | "INTERNAL";

export const CONF_RANK: Record<Confidentiality, number> = { PUBLIC: 0, PRIVATE: 1, SECRET: 2 };
export const VIS_RANK: Record<Visibility, number> = { PUBLIC: 0, PRIVATE: 1, INTERNAL: 2 };

/** Static description of a tool the agent can call. */
export interface ToolSpec {
  name: string;                       // "github.create_pr"
  app: string;                        // "github"
  description: string;
  effect: "read" | "write";
  tier: Tier;
  keywords: string[];                 // words in a request that suggest this tool
  /** argument that scopes the action, e.g. repo, channel, account */
  scopeArg?: string;
  /** arguments whose value decides *where* or *what* the action hits */
  controlArgs?: string[];
  /** arguments that carry content to a sink, with the sink's visibility */
  sinkArgs?: Record<string, Visibility | ((args: Record<string, unknown>) => Visibility)>;
  /** who wrote what this tool returns; tool output is UNTRUSTED unless it is a first-party system of record */
  outputIntegrity?: Integrity;
  /** confidentiality of what this tool returns */
  outputConfidentiality?: Confidentiality | ((args: Record<string, unknown>) => Confidentiality);
  params: Record<string, string>;     // param -> human description
}

export interface ToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface ContractRule {
  tool: string;
  /** allowed values for the scope argument; empty means any */
  scope?: { arg: string; values: string[] };
}

export interface IntentContract {
  id: string;
  sessionId: string;
  task: string;
  allow: ContractRule[];
  default: "deny";
  compiler: "rules" | "llm";
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface ArgLabel {
  arg: string;
  integrity: Integrity;
  confidentiality: Confidentiality;
  sources: string[];
  via?: string;                       // de-obfuscation path that matched, if any
}

export type LayerName = "contract" | "provenance" | "policy" | "causal" | "detector";

export interface LayerResult {
  layer: LayerName;
  outcome: "pass" | "flag" | "block" | "skip";
  detail: string;
}

export interface Decision {
  verdict: Verdict;
  risk: Tier;
  reasons: string[];
  labels: ArgLabel[];
  layers: LayerResult[];
  injectionScore: number;
  causal?: CausalResult;
  latencyMs: number;
}

export interface CausalResult {
  ran: boolean;
  injectionDriven: boolean;
  similarity: number;
  replayedCall?: { tool: string; args: Record<string, unknown> } | null;
  note: string;
}

export interface ShieldSettings {
  contract: boolean;
  provenance: boolean;
  deobfuscate: boolean;
  causal: boolean;
  detector: boolean;
  /** escalate HIGH-tier writes that follow untrusted reads even if nothing is tainted */
  escalateHighAfterUntrusted: boolean;
  approvalTimeoutMs: number;
  /** content similarity under which a replayed action counts as different */
  causalThreshold: number;
}

export const PRESETS: Record<"strict" | "balanced" | "permissive" | "off", ShieldSettings> = {
  strict: {
    contract: true, provenance: true, deobfuscate: true, causal: true, detector: true,
    escalateHighAfterUntrusted: true, approvalTimeoutMs: 120_000, causalThreshold: 0.5,
  },
  balanced: {
    contract: true, provenance: true, deobfuscate: true, causal: true, detector: true,
    escalateHighAfterUntrusted: false, approvalTimeoutMs: 120_000, causalThreshold: 0.5,
  },
  permissive: {
    contract: false, provenance: true, deobfuscate: true, causal: true, detector: true,
    escalateHighAfterUntrusted: false, approvalTimeoutMs: 120_000, causalThreshold: 0.5,
  },
  off: {
    contract: false, provenance: false, deobfuscate: false, causal: false, detector: false,
    escalateHighAfterUntrusted: false, approvalTimeoutMs: 120_000, causalThreshold: 0.5,
  },
};
