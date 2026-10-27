// @agentshield/sdk: put AgentShield in front of any agent's tools.
//
//   const shield = await Shield.fromRequest(userPrompt, { agentId: "dev-agent" });
//   const tools = shield.wrap(myTools);          // Vercel AI SDK tools or any { execute } objects
//   await generateText({ model, tools, prompt: userPrompt });
//
// Every tool call is checked by the core before it runs, and every result is labelled on the
// way back. Blocked calls return a structured message to the model instead of running.

export type Verdict = "ALLOW" | "ESCALATE" | "DENY";

export interface ToolSpecInput {
  name: string;
  app: string;
  description?: string;
  effect: "read" | "write";
  tier: "LOW" | "MEDIUM" | "HIGH" | "FORBIDDEN";
  keywords?: string[];
  scopeArg?: string;
  controlArgs?: string[];
  sinkArgs?: Record<string, "PUBLIC" | "PRIVATE" | "INTERNAL">;
  outputIntegrity?: "TRUSTED" | "UNTRUSTED";
  outputConfidentiality?: "PUBLIC" | "PRIVATE" | "SECRET";
  params?: Record<string, string>;
}

export interface Decision {
  verdict: Verdict;
  risk: string;
  reasons: string[];
  labels: { arg: string; integrity: string; confidentiality: string; sources: string[]; via?: string }[];
  latencyMs: number;
}

export interface ShieldOptions {
  /** core URL, default http://localhost:4317 or AGENTSHIELD_URL */
  url?: string;
  agentId?: string;
  /** restrict the contract compiler to these tool names */
  tools?: string[];
  preset?: "strict" | "balanced" | "permissive";
  systemPrompt?: string;
  /** what a blocked call does: hand a message back to the model (default) or throw */
  onBlock?: "return" | "throw";
}

export class ShieldBlockedError extends Error {
  constructor(public tool: string, public decision: Decision) {
    super(`AgentShield blocked ${tool}: ${decision.reasons[0] ?? decision.verdict}`);
  }
}

type Executable = { execute?: (args: any, ...rest: any[]) => unknown };

async function call<T>(url: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`AgentShield ${path}: ${json.error ?? res.statusText}`);
  return json;
}

export class Shield {
  private seq = 0;

  private constructor(
    private url: string,
    readonly sessionId: string,
    readonly contract: unknown,
    private onBlock: "return" | "throw",
  ) {}

  /** Describe your tools once so the core knows their effect, risk and sinks. */
  static async registerTools(tools: ToolSpecInput[], url = defaultUrl()) {
    return call<{ registered: string[] }>(url, "/v1/tools", { tools });
  }

  /** Compile and sign the intent contract from the user's request, before the agent reads anything. */
  static async fromRequest(task: string, opts: ShieldOptions = {}): Promise<Shield> {
    const url = opts.url ?? defaultUrl();
    const s = await call<{ sessionId: string; contract: unknown }>(url, "/v1/sessions", {
      task, agentId: opts.agentId, tools: opts.tools, preset: opts.preset, systemPrompt: opts.systemPrompt,
    });
    return new Shield(url, s.sessionId, s.contract, opts.onBlock ?? "return");
  }

  /** Ask the shield about one call. Escalations wait for a human in the dashboard. */
  check(tool: string, args: Record<string, unknown>, id = `call-${++this.seq}`) {
    return call<Decision>(this.url, "/v1/check", { sessionId: this.sessionId, call: { id, tool, args } });
  }

  /** Label a tool result so later arguments can be traced back to it. */
  result(tool: string, args: Record<string, unknown>, output: unknown, id: string) {
    return call<{ ok: true }>(this.url, "/v1/result", { sessionId: this.sessionId, call: { id, tool, args }, output });
  }

  /**
   * Returns the same tools with every execute() routed through the shield.
   * Keys must match the names registered with registerTools().
   */
  wrap<T extends Record<string, Executable>>(tools: T): T {
    const out: Record<string, Executable> = {};
    for (const [name, t] of Object.entries(tools)) {
      if (!t.execute) {
        out[name] = t;
        continue;
      }
      const original = t.execute.bind(t);
      out[name] = {
        ...t,
        execute: async (args: Record<string, unknown>, ...rest: unknown[]) => {
          const id = `call-${++this.seq}`;
          const d = await this.check(name, args ?? {}, id);
          if (d.verdict !== "ALLOW") {
            if (this.onBlock === "throw") throw new ShieldBlockedError(name, d);
            return { blocked_by_agentshield: true, verdict: d.verdict, reasons: d.reasons };
          }
          const output = await original(args, ...rest);
          await this.result(name, args ?? {}, output, id);
          return output;
        },
      };
    }
    return out as T;
  }
}

function defaultUrl() {
  return (typeof process !== "undefined" && process.env.AGENTSHIELD_URL) || "http://localhost:4317";
}
