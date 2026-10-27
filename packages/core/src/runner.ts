import { randomUUID } from "node:crypto";
import type { Decision, IntentContract, ShieldSettings, ToolCall } from "./types.js";
import { Shield } from "./engine.js";
import { stringify } from "./provenance.js";
import { maskTask, type Msg, type Scenario } from "./scenarios/types.js";
import { bus } from "./events.js";

export interface RunStep {
  index: number;
  call: ToolCall;
  executed: boolean;
  decision: Decision | null;
  output: string;
}

export interface RunResult {
  id: string;
  scenarioId: string;
  mode: "protected" | "unprotected";
  preset: string;
  settings: ShieldSettings | null;
  sessionId: string | null;
  contract: IntentContract | null;
  task: string;
  steps: RunStep[];
  harm: string | null;
  completed: boolean;
  status: "running" | "done" | "error";
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export const runs = new Map<string, RunResult>();
const MAX_STEPS = 16;

const clip = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n)}...` : s);

export async function runScenario(shield: Shield, sc: Scenario, mode: RunResult["mode"],
  settings: ShieldSettings, preset: string, runId = randomUUID(),
  review?: (d: Decision, call: ToolCall) => boolean | Promise<boolean>): Promise<RunResult> {
  const state = sc.initialState();
  const tools = new Map(sc.tools.map((t) => [t.spec.name, t]));
  const session = mode === "protected"
    ? shield.startSession({ task: sc.task, agentId: sc.id, settings, tools: sc.tools.map((t) => t.spec.name) })
    : null;
  const run: RunResult = {
    id: runId, scenarioId: sc.id, mode, preset, settings: mode === "protected" ? settings : null,
    sessionId: session?.id ?? null, contract: session?.contract ?? null, task: sc.task, steps: [],
    harm: null, completed: false, status: "running", startedAt: new Date().toISOString(),
  };
  runs.set(run.id, run);
  bus.emit("run", { id: run.id, scenarioId: sc.id, mode, status: run.status });

  const history: Msg[] = [{ role: "user", content: sc.task }];
  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      const next = sc.agent(history);
      if (!next) break;
      const call: ToolCall = { id: `c${i + 1}`, tool: next.tool, args: next.args };
      const snapshot = [...history];
      const step: RunStep = { index: i, call, executed: false, decision: null, output: "" };
      run.steps.push(step);

      if (session) {
        step.decision = await shield.check(session.id, call, {
          replay: async () => sc.agent(maskTask(snapshot)),
          review,
        });
      }
      history.push({ role: "call", content: "", tool: call.tool, args: call.args });

      if (!step.decision || step.decision.verdict === "ALLOW") {
        const out = tools.get(call.tool)!.run(call.args, state);
        const text = stringify(out);
        step.executed = true;
        step.output = clip(text);
        const untrusted = (tools.get(call.tool)!.spec.outputIntegrity ?? "UNTRUSTED") === "UNTRUSTED";
        history.push({ role: "tool", tool: call.tool, content: text, untrusted });
        if (session) await shield.recordResult(session.id, call, out);
      } else {
        step.output = `Blocked by AgentShield: ${step.decision.reasons[0] ?? step.decision.verdict}`;
        history.push({ role: "blocked", tool: call.tool, content: step.output });
      }
      bus.emit("run-step", { runId: run.id, step });
    }
    run.harm = sc.harm(state);
    run.completed = sc.completed(state);
    run.status = "done";
  } catch (e) {
    run.status = "error";
    run.error = (e as Error).message;
  }
  run.finishedAt = new Date().toISOString();
  bus.emit("run", { id: run.id, scenarioId: sc.id, mode, status: run.status, harm: run.harm, completed: run.completed });
  return run;
}
