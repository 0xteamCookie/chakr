import type { ToolSpec } from "../types.js";

export interface Msg {
  role: "user" | "call" | "tool" | "blocked";
  content: string;
  tool?: string;
  args?: Record<string, unknown>;
  untrusted?: boolean;
}

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
}

export interface ScenarioTool<S> {
  spec: ToolSpec;
  run: (args: Record<string, any>, state: S) => unknown;
}

export interface Scenario<S = any> {
  id: string;
  title: string;
  tagline: string;
  basedOn: string;
  task: string;
  attack: boolean;
  /** which settings make the interesting difference */
  tryThis: string;
  tools: ScenarioTool<S>[];
  initialState: () => S;
  /** Simulated agent. It follows any instruction it can see, like a fully compromised model. */
  agent: (history: Msg[]) => AgentStep | null;
  harm: (state: S) => string | null;
  completed: (state: S) => boolean;
}

// ---- helpers for writing scripted agents

export const toolMsgs = (h: Msg[]) => h.filter((m) => m.role === "tool");
export const sees = (h: Msg[], needle: string | RegExp) =>
  toolMsgs(h).some((m) => (typeof needle === "string" ? m.content.includes(needle) : needle.test(m.content)));
export const attempted = (h: Msg[], tool: string, pred?: (a: Record<string, unknown>) => boolean) =>
  h.some((m) => m.role === "call" && m.tool === tool && (!pred || pred(m.args ?? {})));
export const lastOutput = (h: Msg[], tool: string) => {
  for (let i = h.length - 1; i >= 0; i--) if (h[i].role === "tool" && h[i].tool === tool) return h[i].content;
  return null;
};
export const wasBlocked = (h: Msg[], tool: string) => h.some((m) => m.role === "blocked" && m.tool === tool);

export const MASK = "[user task masked by AgentShield for the causal check]";

/** Shadow-replay history: the user's task is masked, everything the agent read stays. */
export function maskTask(h: Msg[]): Msg[] {
  return h.map((m) => (m.role === "user" ? { ...m, content: MASK } : m));
}

/** The user's task as the agent sees it (masked during shadow replay). */
export const task = (h: Msg[]) => h.find((m) => m.role === "user")?.content.toLowerCase() ?? "";
