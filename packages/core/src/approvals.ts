// Human-in-the-loop queue. ESCALATE parks the tool call until a reviewer decides
// or the timeout passes. Timeouts deny: the shield never fails open.

import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { bus } from "./events.js";

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
