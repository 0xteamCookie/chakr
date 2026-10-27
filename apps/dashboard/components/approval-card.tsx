"use client";

import { useEffect, useState } from "react";
import { post, fmtArgs, type Approval } from "@/lib/api";
import { Button } from "./ui";

export function ApprovalCard({ a, onDone }: { a: Approval; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.round((Date.parse(a.expiresAt) - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [a.expiresAt]);
  const decide = async (approve: boolean) => {
    setBusy(true);
    await post(`/api/approvals/${a.id}`, { approve, note: approve ? "approved in dashboard" : "denied in dashboard" }).catch(() => null);
    setBusy(false);
    onDone?.();
  };
  const focus = new Set(a.focus ?? []);
  const untrusted = a.labels.filter((l) => l.integrity === "UNTRUSTED" && (!focus.size || focus.has(l.arg)));
  const context = a.labels.filter((l) => l.integrity === "UNTRUSTED" && focus.size > 0 && !focus.has(l.arg));
  return (
    <div className="anim-ring overflow-hidden rounded-2xl border border-amber/30 bg-white">
      <div className="flex items-center justify-between bg-ink px-4 py-2.5 text-white">
        <span className="flex items-center gap-2 text-[13.5px]">
          <span className="h-2 w-2 rounded-full bg-amber pulse-dot" /> Approval needed
          <span className="font-mono text-[11.5px] text-white/60">{a.agentId}</span>
        </span>
        <span className="font-mono text-[11.5px] text-white/70">auto-deny in {left}s</span>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <div className="font-mono text-[14px] font-semibold">{a.tool}</div>
          <div className="mt-0.5 break-all font-mono text-[12px] text-ink-2">{fmtArgs(a.args)}</div>
          <div className="mt-1 text-[12.5px] text-muted">Task: “{a.task}”</div>
        </div>
        <ul className="space-y-1.5">
          {a.reasons.map((r) => {
            const [k, ...rest] = r.split(": ");
            return (
              <li key={r} className="flex gap-2 text-[13px]">
                <span className="shrink-0 rounded-md bg-amber-soft px-1.5 py-0.5 font-mono text-[10.5px] uppercase text-amber">{k}</span>
                <span className="text-ink-2">{rest.join(": ") || k}</span>
              </li>
            );
          })}
        </ul>
        {untrusted.length > 0 && (
          <div className="rounded-xl bg-orange-soft px-3 py-2 text-[12.5px] text-ink-2">
            {untrusted.map((l) => (
              <div key={l.arg}><span className="font-mono font-semibold text-orange">{l.arg}</span> decides where this goes, and it was written by {l.sources.join(", ")}, not by the user.</div>
            ))}
            {context.length > 0 && <div className="mt-1 text-[11.5px] text-muted">Also from tool output: {context.map((l) => l.arg).join(", ")}.</div>}
          </div>
        )}
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className={`text-[13px] font-semibold ${a.recommended === "deny" ? "text-red" : "text-green"}`}>
            Recommended: {a.recommended}
          </span>
          <div className="flex gap-2">
            <Button variant="light" disabled={busy} onClick={() => decide(true)}>Approve once</Button>
            <Button variant="danger" disabled={busy} onClick={() => decide(false)}>Deny</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
