// Human-in-the-loop queue. ESCALATE parks the tool call until a reviewer decides
// or the timeout passes. Timeouts deny: the shield never fails open.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "./db.js";
import { bus } from "./events.js";
import { DATA_DIR } from "./crypto.js";
import type { ToolCall, ToolSpec } from "./types.js";

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  agentId: string;
  task: string;
  tool: string;
  args: Record<string, unknown>;
  reasons: string[];
  labels: unknown[];
  /** the arguments that decide where the action goes; the card leads with these */
  focus: string[];
  causal: unknown;
  recommended: "approve" | "deny";
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "denied" | "expired";
}

export interface ApprovalOutcome {
  approved: boolean;
  by: "human" | "timeout";
  note?: string;
}

const pending = new Map<string, { req: ApprovalRequest; resolve: (o: ApprovalOutcome) => void; timer: NodeJS.Timeout }>();

export async function requestApproval(r: Omit<ApprovalRequest, "id" | "createdAt" | "expiresAt" | "status">,
  timeoutMs: number): Promise<ApprovalOutcome> {
  const now = Date.now();
  const req: ApprovalRequest = {
    ...r,
    id: randomUUID(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + timeoutMs).toISOString(),
    status: "pending",
  };
  await db.approval.create({
    data: {
      id: req.id, sessionId: req.sessionId, tool: req.tool, args: JSON.stringify(req.args),
      reasons: JSON.stringify(req.reasons), context: JSON.stringify({ labels: req.labels, causal: req.causal, task: req.task }),
      status: "pending",
    },
  });
  return new Promise((resolve) => {
    const timer = setTimeout(() => void decide(req.id, false, "timeout", "timed out"), timeoutMs);
    pending.set(req.id, { req, resolve, timer });
    bus.emit("approval", req);
  });
}

export async function decide(id: string, approved: boolean, by: "human" | "timeout" = "human", note?: string) {
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  p.req.status = by === "timeout" ? "expired" : approved ? "approved" : "denied";
  await db.approval.update({
    where: { id },
    data: { status: p.req.status, decidedBy: by, note, decidedAt: new Date() },
  });
  bus.emit("approval", p.req);
  p.resolve({ approved, by, note });
  return true;
}

export function pendingApprovals(): ApprovalRequest[] {
  return [...pending.values()].map((p) => p.req);
}

// ------------------------------------------------------------------ denial memory
// Approving is one-off: the same action asks again next time. Denying is remembered: the same action
// (same tool, same deciding arguments) is denied without asking. It can be switched off, e.g. for demos.

export interface DeniedAction { key: string; tool: string; args: Record<string, unknown>; at: string }
interface Memory { enabled: boolean; denied: DeniedAction[] }

const memoryFile = () => join(DATA_DIR, "approval-memory.json");
let memory: Memory | null = null;

function loadMemory(): Memory {
  if (memory) return memory;
  try { memory = existsSync(memoryFile()) ? JSON.parse(readFileSync(memoryFile(), "utf8")) as Memory : null; } catch { memory = null; }
  memory ??= { enabled: true, denied: [] };
  return memory;
}
function saveMemory() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(memoryFile(), JSON.stringify(loadMemory(), null, 2));
  bus.emit("approval", { memory: true });
}

/** Same tool and same deciding arguments: "48,000 to 9988 7720" and "48000 to 99887720" are one action. */
export function actionKey(call: ToolCall, spec?: ToolSpec): string {
  const keys = spec?.controlArgs?.length ? spec.controlArgs : Object.keys(call.args).sort();
  const norm = (v: unknown) => {
    const t = (typeof v === "string" ? v : JSON.stringify(v ?? "")).trim().toLowerCase();
    const digits = t.replace(/[^0-9]/g, "");
    return digits.length >= 4 && digits.length >= t.replace(/[\s,.-]/g, "").length ? digits : t.replace(/\s+/g, " ");
  };
  return `${call.tool}|${keys.map((k) => `${k}=${norm(call.args[k])}`).join("|")}`;
}

export const denialMemory = () => loadMemory();
export function deniedBefore(key: string): DeniedAction | undefined {
  const m = loadMemory();
  return m.enabled ? m.denied.find((d) => d.key === key) : undefined;
}
export function rememberDenial(key: string, call: ToolCall) {
  const m = loadMemory();
  if (m.denied.some((d) => d.key === key)) return;
  m.denied.unshift({ key, tool: call.tool, args: call.args, at: new Date().toISOString() });
  m.denied = m.denied.slice(0, 200);
  saveMemory();
}
export function setDenialMemory(enabled: boolean) { loadMemory().enabled = enabled; saveMemory(); }
export function forgetDenials() { loadMemory().denied = []; saveMemory(); }
