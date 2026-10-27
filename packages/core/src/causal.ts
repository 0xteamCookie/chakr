// Risk-adaptive causal check (shadow replay).
// Re-run the agent's last decision with the USER'S TASK masked out and everything it read kept.
// If the same action still comes back, the user's task was not what drove it: the content the
// agent read was. If the action disappears, it came from the task. This is the masked
// re-execution test of MELON (Zhu et al., ICML 2025); we only run it on high-risk calls that
// the deterministic layers could not settle, instead of on every step.

import type { CausalResult, ToolCall, ToolSpec } from "./types.js";
import { jaccard, normalizeValue, shingles } from "./normalize.js";
import { stringify } from "./provenance.js";

/** Asks the agent for its next tool call given the same history with the user's task masked. */
export type ReplayFn = () => Promise<{ tool: string; args: Record<string, unknown> } | null>;

export function similarity(spec: ToolSpec | undefined, a: ToolCall, b: { tool: string; args: Record<string, unknown> }): number {
  if (a.tool !== b.tool) return 0;
  const control = new Set(spec?.controlArgs ?? []);
  for (const k of control) {
    if (normalizeValue(stringify(a.args[k])) !== normalizeValue(stringify(b.args[k]))) return 0;
  }
  const rest = (c: { args: Record<string, unknown> }) =>
    Object.entries(c.args).filter(([k]) => !control.has(k)).map(([, v]) => stringify(v)).join(" ");
  const ra = rest(a);
  const rb = rest(b);
  if (!ra && !rb) return 1;
  return Number(jaccard(shingles(ra, 2), shingles(rb, 2)).toFixed(2));
}

export async function causalCheck(spec: ToolSpec | undefined, call: ToolCall, replay: ReplayFn | undefined,
  threshold: number): Promise<CausalResult> {
  if (!replay) {
    return { ran: false, injectionDriven: false, similarity: 1, note: "no replay available for this agent" };
  }
  const replayed = await replay();
  if (!replayed) {
    return {
      ran: true, injectionDriven: false, similarity: 0, replayedCall: null,
      note: "without the user's task the agent does nothing, so the task drove this action",
    };
  }
  const sim = similarity(spec, call, replayed);
  const injectionDriven = sim >= threshold;
  return {
    ran: true,
    injectionDriven,
    similarity: sim,
    replayedCall: replayed,
    note: injectionDriven
      ? `the agent repeats this action even with the user's task masked (similarity ${sim}): the content it read is driving it`
      : `with the task masked the agent does something else (similarity ${sim}), so the task drove this action`,
  };
}
