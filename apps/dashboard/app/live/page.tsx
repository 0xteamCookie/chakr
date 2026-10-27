"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, post, fmtArgs, useLive, type Approval, type ArgLabel } from "@/lib/api";
import { Button, Toggle, VerdictChip } from "@/components/ui";
import { ApprovalCard } from "@/components/approval-card";

interface Email { from: string; subject: string; body: string; attacker?: boolean }
interface Step {
  id: string; kind: "text" | "tool"; text?: string; tool?: string; args?: Record<string, unknown>;
  status?: string; verdict?: "ALLOW" | "DENY" | "ESCALATE" | "EXECUTED"; reasons?: string[]; labels?: ArgLabel[];
  provenance?: string[]; executed?: boolean; output?: string;
}
interface World {
  balance: number; payments: { to_account: string; amount: number; memo: string }[];
  sent: { to: string; subject: string; body: string }[]; files: { name: string; private: boolean; deleted: boolean }[];
}
interface LiveRun {
  id: string; task: string; shield: boolean; mode: "live" | "scripted"; model: string; banner: string | null;
  status: "running" | "done" | "error"; error?: string; steps: Step[]; world: World; startBalance: number;
  outcome: { kind: string; headline: string; detail: string[]; stolen: number } | null;
}
interface Defaults { inbox: Email[]; tasks: string[]; model: string; hasKey: boolean }

const fmt = (n: number) => n.toLocaleString("en-US");

export default function LivePage() {
  const [defs, setDefs] = useState<Defaults | null>(null);
  const [inbox, setInbox] = useState<Email[]>([]);
  const [task, setTask] = useState("Pay the invoices that are due");
  const [shield, setShield] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<LiveRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const approvals = useLive<Approval[]>("/api/approvals", ["approval"], 1500);

  useEffect(() => {
    api<Defaults>("/api/live/defaults").then((d) => { setDefs(d); setInbox(d.inbox); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const load = () => api<LiveRun>(`/api/live/${runId}`).then((r) => alive && setRun(r)).catch(() => null);
    load();
    const t = setInterval(load, 500);
    return () => { alive = false; clearInterval(t); };
  }, [runId]);

  const running = run?.status === "running";
  const start = async (scripted = false) => {
    setError(null); setRun(null);
    try { setRunId((await post<{ id: string }>("/api/live", { task, shield, inbox, scripted })).id); }
    catch (e) { setError((e as Error).message); }
  };
  const edit = (i: number, patch: Partial<Email>) => setInbox((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const mine = (approvals.data ?? []).filter((a) => run && a.task === run.task);
  const w = run?.world;
  const tone = run?.outcome ? (run.outcome.kind === "attacker_paid" || run.outcome.kind === "data_leaked" ? "orange" : "blue") : null;

  return (
    <div className="grid gap-6 pt-4 lg:grid-cols-[minmax(0,460px)_1fr]">
      <section className="card h-fit space-y-4 p-5">
        <div>
          <div className="text-[15px] font-semibold">Live agent</div>
          <p className="kbd mt-0.5">a real model, real tool calls, mock accounts</p>
        </div>
        <div>
          <label className="kbd" htmlFor="task">Task</label>
          <input id="task" value={task} onChange={(e) => setTask(e.target.value)}
            className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-[14px]" />
          <div className="mt-2 flex flex-wrap gap-2">
            {(defs?.tasks ?? []).map((t) => (
              <button key={t} type="button" onClick={() => setTask(t)}
                className="rounded-full border border-line bg-canvas px-3 py-1 text-[12.5px] hover:border-ink/30">{t}</button>
            ))}
          </div>
        </div>
        <Toggle label="Shield" hint={shield ? "On: every tool call is checked before it runs." : "Off: the agent's tools run directly."} checked={shield} onChange={setShield} />
        <div className="flex gap-2">
          <Button onClick={() => start(false)} disabled={running || !task.trim()}>{running ? "Running..." : "Run"}</Button>
          <Button variant="light" onClick={() => start(true)} disabled={running}>Run recorded replay</Button>
        </div>
        {defs && !defs.hasKey && <p className="text-[12.5px] text-amber">No Gemini key on the server: runs use the recorded replay.</p>}
        {error && <p className="text-[12.5px] text-red">{error}</p>}
        <hr className="border-line" />
        <div className="text-[13.5px] font-semibold">Inbox (editable)</div>
        <div className="space-y-3">
          {inbox.map((m, i) => (
            <div key={i} className={`rounded-xl border p-3 ${m.attacker ? "border-orange/40 bg-orange-soft" : "border-line bg-white"}`}>
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="font-mono text-muted">#{i + 1} from {m.from}</span>
                {m.attacker && <span className="rounded-md bg-orange px-1.5 py-0.5 font-mono text-[10.5px] uppercase text-white">Attacker</span>}
              </div>
              <div className="mt-1 text-[13px] font-medium">{m.subject}</div>
              <textarea value={m.body} onChange={(e) => edit(i, { body: e.target.value })} rows={m.attacker ? 6 : 3}
                className="mt-1 w-full rounded-lg border border-line bg-white p-2 text-[12.5px]" />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        {run?.banner && <div className="rounded-xl border border-amber/30 bg-amber-soft px-4 py-2.5 text-[13px] text-amber">{run.banner}</div>}
        {run?.outcome && (
          <div className={`rounded-2xl px-5 py-4 ${tone === "orange" ? "bg-orange text-white" : "bg-blue text-white"}`}>
            <div className="font-display text-[22px] font-extrabold">{run.outcome.headline}</div>
            <ul className="mt-1 text-[13.5px] opacity-90">{run.outcome.detail.map((d) => <li key={d}>{d}</li>)}</ul>
            <Link href="/audit" className="mt-2 inline-block text-[13px] underline">See receipts</Link>
          </div>
        )}
        {mine.map((a) => <ApprovalCard key={a.id} a={a} onDone={() => approvals.reload().catch(() => null)} />)}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-semibold">Agent steps</div>
            {run && <span className="kbd">{run.mode === "live" ? `live: ${run.model}` : "recorded replay"} / shield {run.shield ? "on" : "off"}</span>}
          </div>
          {!run && <p className="mt-3 text-[13.5px] text-muted">Press Run to start the agent.</p>}
          <ol className="mt-3 space-y-2.5">
            {run?.steps.map((s) => s.kind === "text" ? (
              <li key={s.id} className="whitespace-pre-wrap rounded-xl bg-canvas px-3 py-2 text-[13.5px] text-ink-2">{s.text}</li>
            ) : (
              <li key={s.id} className="rounded-xl border border-line px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13.5px] font-semibold">{s.tool}</span>
                  {s.verdict && <VerdictChip verdict={s.status === "waiting" ? "PENDING" : s.verdict} />}
                  {s.status === "running" && <span className="kbd">running</span>}
                </div>
                <div className="mt-0.5 break-all font-mono text-[12px] text-ink-2">{fmtArgs(s.args ?? {})}</div>
                {s.verdict !== "EXECUTED" && s.verdict !== "ALLOW" && s.reasons?.slice(0, 3).map((r) => <div key={r} className="mt-1 text-[12.5px] text-red">{r}</div>)}
                {s.provenance?.map((p) => <div key={p} className="mt-1 text-[12.5px] text-orange">Provenance: {p}</div>)}
                {s.output && <div className="mt-1 line-clamp-2 break-all font-mono text-[11.5px] text-muted">{s.output}</div>}
              </li>
            ))}
          </ol>
        </div>
        {w && (
          <div className="card p-5">
            <div className="text-[15px] font-semibold">World state</div>
            <div className="mt-2 grid gap-3 text-[13.5px] sm:grid-cols-2">
              <div>Balance: <b>{fmt(run!.startBalance)}</b> to <b>{fmt(w.balance)}</b></div>
              <div>Emails sent: <b>{w.sent.length}</b>{w.sent.map((m, i) => <div key={i} className="font-mono text-[12px] text-orange">to {m.to}</div>)}</div>
              <div>Payments: <b>{w.payments.length}</b>{w.payments.map((p, i) => <div key={i} className="font-mono text-[12px]">{fmt(p.amount)} to {p.to_account}</div>)}</div>
              <div>Files: {w.files.map((f) => <div key={f.name} className={`font-mono text-[12px] ${f.deleted ? "line-through" : ""}`}>{f.name}{f.private ? " (private)" : ""}</div>)}</div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
