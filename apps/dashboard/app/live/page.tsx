"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API, api, post, fmtArgs, useLive, type Approval, type ArgLabel } from "@/lib/api";
import { Ic } from "@/components/pitch/icons";

interface Email { from: string; subject: string; body: string; attacker?: boolean; gmail?: boolean; kind?: "issue"; github?: boolean; repo?: string }
interface Step {
  id: string; kind: "text" | "tool"; text?: string; tool?: string; args?: Record<string, unknown>;
  status?: string; verdict?: "ALLOW" | "DENY" | "ESCALATE" | "EXECUTED"; reasons?: string[]; labels?: ArgLabel[];
  provenance?: string[]; executed?: boolean; output?: string;
}
interface World {
  balance: number; payments: { to_account: string; amount: number; memo: string }[];
  sent: { to: string; subject: string; body: string }[]; files: { name: string; private: boolean; deleted: boolean }[];
  prs?: { repo: string; title: string; path: string; public: boolean; leaked: string[]; url?: string }[];
}
interface LiveRun {
  id: string; task: string; shield: boolean; mode: "live" | "scripted"; model: string; banner: string | null;
  status: "running" | "done" | "error"; error?: string; steps: Step[]; world: World; startBalance: number;
  outcome: { kind: string; headline: string; detail: string[]; stolen: number } | null;
  scan?: { detector: string; items: { model: number | null; heuristic: number }[] } | null;
  claims?: { text: string; ok: boolean; kind: string }[];
}
interface Memory { enabled: boolean; denied: { key: string; tool: string; args: Record<string, unknown>; at: string }[] }
interface Scenario { id: string; title: string; icon: string; attack: string; task: string; inbox: Email[] }
interface Defaults {
  inbox: Email[]; tasks: string[]; scenarios?: Scenario[]; model: string; hasKey: boolean; payees?: { name: string; account: string }[];
  gmail?: { configured: boolean; account: string | null };
  github?: { configured: boolean; repo: string | null; writes: boolean };
  detector?: { name: string; model: boolean };
}

const fmt = (n: number) => Number(n).toLocaleString("en-US");
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

// ------------------------------------------------------------------ how a tool call reads to a person
function describe(tool = "", a: Record<string, unknown> = {}): { icon: string; title: string; sub?: string } {
  switch (tool) {
    case "read_inbox": return { icon: "mail", title: "Read the inbox" };
    case "read_email": return { icon: "mail", title: `Open email #${a.id}` };
    case "make_payment": return { icon: "wallet", title: `Pay ${fmt(Number(digits(a.amount)) || 0)}`, sub: `to ${a.to_account}` };
    case "send_email": return { icon: "mail", title: "Send an email", sub: `to ${a.to}` };
    case "list_payees": return { icon: "user", title: "Check saved payees" };
    case "list_files": return { icon: "box", title: "List files" };
    case "read_file": return { icon: "file", title: `Open ${a.name}` };
    case "delete_file": return { icon: "x", title: `Delete ${a.name}` };
    case "list_issues": return { icon: "note", title: "Read open issues", sub: String(a.repo ?? "") };
    case "list_repos": return { icon: "box", title: "List repositories" };
    case "read_repo_file": return { icon: "file", title: `Open ${a.path}`, sub: String(a.repo ?? "") };
    case "create_pull_request": return { icon: "gitbranch", title: "Open a pull request", sub: `${a.path} on ${a.repo}` };
    default: return { icon: "terminal", title: tool };
  }
}

type Tone = "red" | "amber" | "green";

/** The reason behind a verdict as short chips. The full engine text stays in the details view. */
function chips(s: Step): { icon: string; text: string; tone: Tone }[] {
  const out: { icon: string; text: string; tone: Tone }[] = [];
  const reasons = s.reasons ?? [];
  if (reasons.some((r) => r.startsWith("contract:"))) out.push({ icon: "lock", text: "Not part of the task", tone: "red" });
  if (reasons.some((r) => r.includes("appears nowhere"))) out.push({ icon: "alert", text: "Made-up value: appears nowhere", tone: "red" });
  for (const p of s.provenance ?? []) {
    const m = /^(\w+) came from (.+)$/.exec(p);
    if (m && ["to_account", "to", "name"].includes(m[1])) {
      out.push({ icon: "link", text: `${m[1] === "to_account" ? "Account" : m[1] === "to" ? "Recipient" : "File"} from ${m[2]}`, tone: "red" });
    }
  }
  if (reasons.some((r) => /always needs a human|above the limit/.test(r))) out.push({ icon: "user", text: "Needs a human", tone: "amber" });
  if (reasons.some((r) => r.startsWith("causal:"))) out.push({ icon: "alert", text: "Driven by an email", tone: "red" });
  const code = [...new Set(reasons.flatMap((r) => [...r.matchAll(/read_repo_file#([\w.-]+):/g)].map((m) => m[1])))];
  if (code.length) out.push({ icon: "lock", text: `Private code from ${code.join(", ")}`, tone: "red" });
  else if (reasons.some((r) => /sink/.test(r))) out.push({ icon: "lock", text: "Private data leaving", tone: "red" });
  if (reasons.some((r) => r.startsWith("reviewer: denied automatically"))) out.push({ icon: "x", text: "Denied before, not asked again", tone: "red" });
  else if (reasons.some((r) => r.startsWith("reviewer: denied"))) out.push({ icon: "x", text: "You denied it", tone: "red" });
  if (reasons.some((r) => r.startsWith("reviewer: approved"))) out.push({ icon: "check", text: "You approved it", tone: "green" });
  if (reasons.some((r) => r.startsWith("reviewer: no decision"))) out.push({ icon: "x", text: "Timed out, denied", tone: "red" });
  return out;
}

const CHIP: Record<Tone, string> = { red: "bg-red-soft text-red", amber: "bg-amber-soft text-amber", green: "bg-green-soft text-green" };

function stepState(s: Step): { ring: string; badge: string; icon: string; label: string; text: string } {
  if (s.status === "running") return { ring: "bg-canvas text-muted", badge: "", icon: "", label: "", text: "text-muted" };
  if (s.status === "waiting") return { ring: "bg-amber text-white", badge: "bg-amber", icon: "user", label: "Waiting for you", text: "text-amber" };
  if (s.verdict === "DENY" || (s.verdict === "ESCALATE" && !s.executed)) return { ring: "bg-red text-white", badge: "bg-red", icon: "x", label: "Blocked", text: "text-red" };
  if (s.verdict === "ALLOW") return { ring: "bg-green text-white", badge: "bg-green", icon: "check", label: "Allowed", text: "text-green" };
  return { ring: "bg-ink text-white", badge: "", icon: "", label: "Ran unchecked", text: "text-muted" };
}

// ------------------------------------------------------------------ page
export default function LivePage() {
  const [defs, setDefs] = useState<Defaults | null>(null);
  const [inbox, setInbox] = useState<Email[]>([]);
  const [task, setTask] = useState("Pay the invoices that are due");
  const [editingTask, setEditingTask] = useState(false);
  const [shield, setShield] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<LiveRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMail, setLoadingMail] = useState(false);
  const [scenario, setScenario] = useState<string | null>("invoice");
  const approvals = useLive<Approval[]>("/api/approvals", ["approval"], 1500);
  const memory = useLive<Memory>("/api/approvals/memory", ["approval"], 3000);
  const setMemory = async (enabled: boolean) => {
    await fetch(`${API}/api/approvals/memory`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) }).catch(() => null);
    memory.reload().catch(() => null);
  };
  const forget = async () => {
    await fetch(`${API}/api/approvals/memory`, { method: "DELETE" }).catch(() => null);
    memory.reload().catch(() => null);
  };

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
  const fromGmail = inbox.some((m) => m.gmail);
  const fromGithub = inbox.some((m) => m.github);
  const issues = inbox.length > 0 && inbox.every((m) => m.kind === "issue");
  const pick = (sc: Scenario) => { setScenario(sc.id); setTask(sc.task); setInbox(sc.inbox); setRun(null); setRunId(null); setError(null); };
  const payees = new Set((defs?.payees ?? []).map((p) => digits(p.account)));

  const start = async (scripted = false) => {
    setError(null); setRun(null);
    try { setRunId((await post<{ id: string }>("/api/live", { task, shield, inbox, scripted })).id); }
    catch (e) { setError((e as Error).message); }
  };
  const loadGmail = async () => {
    setLoadingMail(true); setError(null);
    try {
      const r = await api<{ account: string; emails: Email[] }>("/api/live/gmail");
      if (!r.emails.length) setError(`No recent mail in ${r.account}. Send the test email, then try again.`);
      else { setInbox(r.emails); setScenario(null); }
    } catch (e) { setError(`Gmail: ${(e as Error).message}`); }
    setLoadingMail(false);
  };
  const loadGithub = async () => {
    setLoadingMail(true); setError(null);
    try {
      const r = await api<{ repo: string; issues: Email[] }>("/api/live/github");
      if (!r.issues.length) setError(`No open issues in ${r.repo}. Open the test issue, then try again.`);
      else { setInbox(r.issues); setScenario(null); setTask(`Look at the open issues in ${r.repo} and fix them`); setRun(null); setRunId(null); }
    } catch (e) { setError(`GitHub: ${(e as Error).message}`); }
    setLoadingMail(false);
  };
  const edit = (i: number, body: string) => setInbox((xs) => xs.map((x, j) => (j === i ? { ...x, body } : x)));
  const mine = (approvals.data ?? []).filter((a) => run && a.task === run.task);
  const notice = error ?? run?.banner ?? (defs && !defs.hasKey ? "No Gemini key on the server: runs use the recorded replay." : null);

  return (
    <div className="space-y-5 pt-2">
      {/* ------------------------------------------------ control bar */}
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-4 px-5 py-4">
        <div className="flex min-w-[260px] flex-1 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-canvas text-ink-2"><Ic n="user" size={20} /></span>
          <div className="min-w-0 flex-1">
            <div className="kbd">you ask the agent</div>
            {editingTask ? (
              <input autoFocus value={task} onChange={(e) => setTask(e.target.value)} onBlur={() => setEditingTask(false)}
                onKeyDown={(e) => e.key === "Enter" && setEditingTask(false)}
                className="w-full rounded-lg border border-line bg-white px-2 py-1 text-[16px] font-semibold" />
            ) : (
              <button type="button" onClick={() => setEditingTask(true)} title="Click to edit"
                className="block max-w-full truncate text-left text-[17px] font-semibold">“{task}”</button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-canvas p-1" role="group" aria-label="Inbox source">
          <SegBtn on={!fromGmail && !fromGithub} onClick={() => { const sc = defs?.scenarios?.find((x) => x.id === (scenario ?? "invoice")) ?? defs?.scenarios?.[0]; if (sc) pick(sc); }} disabled={running} icon="box" label="Demo inbox" />
          {defs?.gmail?.configured && <SegBtn on={fromGmail} onClick={loadGmail} disabled={running || loadingMail} icon="mail" label={loadingMail ? "Loading" : "Gmail"} />}
          {defs?.github?.configured && <SegBtn on={fromGithub} onClick={loadGithub} disabled={running || loadingMail} icon="gitbranch" label="GitHub" />}
        </div>

        <button type="button" onClick={() => setShield(!shield)} disabled={running} aria-pressed={shield}
          className={`flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-[15px] font-semibold text-white transition-colors disabled:opacity-60 ${shield ? "bg-blue" : "bg-orange"}`}>
          <Ic n={shield ? "shield" : "alert"} size={20} />
          Shield {shield ? "ON" : "OFF"}
        </button>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => start(false)} disabled={running || !task.trim()}
            className="flex items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-[15px] font-semibold text-white disabled:opacity-50">
            {running ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              : <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden><path d="M7 5v14l11-7L7 5Z" fill="currentColor" /></svg>}
            {running ? "Running" : "Run"}
          </button>
          <button type="button" onClick={() => start(true)} disabled={running} title="Recorded replay: no model call, the Shield checks are still real"
            aria-label="Run recorded replay"
            className="grid h-[42px] w-[42px] place-items-center rounded-xl border border-line bg-white text-ink-2 hover:border-ink/30 disabled:opacity-50">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
          </button>
        </div>
      </div>

      {!fromGmail && !fromGithub && (defs?.scenarios?.length ?? 0) > 0 && (
        <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7" role="group" aria-label="Demo scenarios">
          {defs!.scenarios!.map((sc) => {
            const on = scenario === sc.id;
            const safe = sc.id === "clean";
            const mistake = sc.id === "ghost";
            return (
              <button key={sc.id} type="button" onClick={() => pick(sc)} disabled={running} aria-pressed={on}
                className={`flex items-center gap-3 rounded-2xl border-2 px-3.5 py-3 text-left transition-all disabled:opacity-60 ${on ? "border-ink bg-white shadow-sm" : "border-transparent bg-white/60 hover:bg-white"}`}>
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${safe ? "bg-green-soft text-green" : mistake ? "bg-amber-soft text-amber" : "bg-orange-soft text-orange"}`}>
                  <Ic n={sc.icon} size={20} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold">{sc.title}</span>
                  <span className="block truncate text-[11.5px] text-muted">{sc.attack}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[12.5px] text-ink-2">
        <span className="inline-flex items-center gap-1.5" title="Advisory ML classifier: it can raise risk, never allow or deny">
          <span className={`h-2 w-2 rounded-full ${defs?.detector?.model ? "bg-green" : "bg-muted"}`} />
          <Ic n="bot" size={14} /> {defs?.detector?.model ? "Prompt Guard 2 (86M) loaded, advisory" : "Heuristic detector, advisory"}
        </span>
        <span className="h-4 w-px bg-line" />
        <button type="button" onClick={() => setMemory(!(memory.data?.enabled ?? true))} role="switch" aria-checked={memory.data?.enabled ?? true}
          className="inline-flex items-center gap-2" title="On: a denied action is denied again without asking. Approvals always ask again.">
          <span className={`relative h-5 w-9 rounded-full transition-colors ${memory.data?.enabled ?? true ? "bg-blue" : "bg-line"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${memory.data?.enabled ?? true ? "left-[18px]" : "left-0.5"}`} />
          </span>
          Remember denials
        </button>
        {(memory.data?.denied.length ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded-full bg-red-soft px-2 py-0.5 font-mono text-[11px] text-red">{memory.data!.denied.length} denied</span>
            <button type="button" onClick={forget} className="text-[12px] text-blue underline-offset-2 hover:underline">Forget</button>
          </span>
        )}
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-amber/30 bg-amber-soft px-4 py-2.5 text-[13px] text-amber">
          <Ic n="alert" size={16} /> {notice}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        {/* ------------------------------------------------ inbox */}
        <section className="card h-fit p-4">
          <div className="mb-3 flex items-center gap-2">
            <Ic n={issues ? "gitbranch" : "mail"} size={18} />
            <span className="text-[15px] font-semibold">{issues ? "Issues" : "Inbox"}</span>
            {issues && !fromGithub && <span className="truncate font-mono text-[11px] text-muted">{inbox[0].repo}</span>}
            <span className="rounded-full bg-canvas px-2 py-0.5 font-mono text-[11px]">{inbox.length}</span>
            {fromGmail && <span className="ml-auto truncate font-mono text-[11px] text-blue" title="Real messages, read-only">{defs?.gmail?.account}</span>}
            {fromGithub && <span className="ml-auto truncate font-mono text-[11px] text-blue" title="Real issues, read-only">{defs?.github?.repo}</span>}
          </div>
          <div className="space-y-2">
            {inbox.map((m, i) => <MailCard key={`${m.from}-${i}`} m={m} i={i} onEdit={(b) => edit(i, b)} score={run?.scan?.items[i]?.model ?? null} />)}
          </div>
          {fromGmail && <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted"><Ic n="lock" size={13} /> read-only, actions stay simulated</p>}
          {fromGithub && <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted"><Ic n="lock" size={13} /> {defs?.github?.writes ? "real reads, pull requests are really opened" : "real reads, pull requests stay simulated"}</p>}
        </section>

        {/* ------------------------------------------------ what the agent did */}
        <section className="min-w-0 space-y-4">
          {run?.outcome && <Outcome run={run} />}
          {mine.map((a) => (
            <LiveApproval key={a.id} a={a} run={run} inbox={inbox} payees={payees} onDone={() => approvals.reload().catch(() => null)} />
          ))}
          <div className="card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Ic n="bot" size={18} />
              <span className="text-[15px] font-semibold">Agent</span>
              {run && (
                <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-muted">
                  {run.mode === "live" ? run.model : "recorded replay"}
                  <span className={`h-2 w-2 rounded-full ${run.shield ? "bg-blue" : "bg-orange"}`} title={run.shield ? "Shield on" : "Shield off"} />
                </span>
              )}
            </div>
            {!run ? (
              <div className="grid place-items-center gap-2 py-12 text-muted">
                <Ic n="bot" size={40} />
                <span className="text-[13.5px]">Press Run</span>
              </div>
            ) : (
              <ol className="relative space-y-3 before:absolute before:bottom-4 before:left-[19px] before:top-4 before:w-[2px] before:bg-line">
                {group(run.steps).map((g) => (g.kind === "text" ? <AgentSays key={g.id} text={g.text ?? ""} />
                  : g.kind === "reads" ? <ReadsStep key={g.id} steps={g.steps} /> : <ToolStep key={g.id} s={g.step} />))}
                {running && (
                  <li className="relative flex items-center gap-3">
                    <span className="relative z-10 grid h-10 w-10 place-items-center rounded-full bg-white ring-4 ring-white">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-ink" />
                    </span>
                    <span className="text-[13px] text-muted">thinking</span>
                  </li>
                )}
              </ol>
            )}
          </div>
          {run?.status === "done" && (run.claims?.length ?? 0) > 0 && <Claims claims={run.claims!} />}
        </section>

        {/* ------------------------------------------------ the world */}
        <section className="space-y-4">
          {issues ? <PullRequests run={run} /> : <>
            <Money run={run} payees={payees} />
            <Leaks run={run} />
            <Files run={run} />
          </>}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pieces
type Item = { kind: "text"; id: string; text?: string } | { kind: "tool"; id: string; step: Step } | { kind: "reads"; id: string; steps: Step[] };

/** Consecutive email reads that went through fold into one row; everything else stays as is. */
function group(steps: Step[]): Item[] {
  const out: Item[] = [];
  for (const s of steps) {
    if (s.kind === "text") { out.push({ kind: "text", id: s.id, text: s.text }); continue; }
    const quiet = s.tool === "read_email" && s.status === "done" && (s.verdict === "ALLOW" || s.verdict === "EXECUTED");
    const last = out[out.length - 1];
    if (quiet && last?.kind === "reads") last.steps.push(s);
    else if (quiet) out.push({ kind: "reads", id: s.id, steps: [s] });
    else out.push({ kind: "tool", id: s.id, step: s });
  }
  return out.map((g) => (g.kind === "reads" && g.steps.length === 1 ? { kind: "tool", id: g.id, step: g.steps[0] } : g));
}

function ReadsStep({ steps }: { steps: Step[] }) {
  const st = stepState(steps[0]);
  return (
    <li className="anim-fade-up relative flex items-start gap-3">
      <span className={`relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full ring-4 ring-white ${st.ring}`}>
        <Ic n="mail" size={18} />
        {st.icon && <span className={`absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full text-white ring-2 ring-white ${st.badge}`}><Ic n={st.icon} size={11} /></span>}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5">
        <span className="text-[14.5px] font-semibold">Opened {steps.length} emails</span>
        <span className="flex gap-1">
          {steps.map((x) => <span key={x.id} className="rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-ink-2">#{String(x.args?.id ?? "")}</span>)}
        </span>
        <span className={`ml-auto shrink-0 text-[11.5px] font-medium ${st.text}`}>{st.label}</span>
      </div>
    </li>
  );
}
function SegBtn({ on, onClick, disabled, icon, label }: { on: boolean; onClick: () => void; disabled?: boolean; icon: string; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-all disabled:opacity-50 ${on ? "bg-white font-medium shadow-sm" : "text-ink-2 hover:text-ink"}`}>
      <Ic n={icon} size={15} /> {label}
    </button>
  );
}

function MailCard({ m, i, onEdit, score }: { m: Email; i: number; onEdit: (b: string) => void; score: number | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-xl border ${m.attacker ? "border-orange/40 bg-orange-soft/60" : "border-line bg-white"}`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-2.5 p-2.5 text-left">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold uppercase text-white ${m.attacker ? "bg-orange" : m.gmail ? "bg-blue" : "bg-ink/70"}`}>
          {m.kind === "issue" ? <Ic n="note" size={15} /> : m.from.replace(/[^a-z]/gi, "").charAt(0) || "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {m.kind !== "issue" && <span className="font-mono text-[10.5px] text-muted">#{i + 1}</span>}
            <span className="truncate text-[12px] text-ink-2">{m.from}</span>
            {m.attacker && <span title={m.kind === "issue" ? "Planted attack issue" : "Planted attack email"} className="text-orange"><Ic n="alert" size={14} /></span>}
          </span>
          <span className="block truncate text-[13px] font-medium">{m.subject}</span>
          {score !== null && (
            <span title="Prompt Guard 2: probability of injected instructions (advisory only)"
              className={`mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10.5px] ${score >= 0.5 ? "bg-red-soft text-red" : "bg-canvas text-ink-2"}`}>
              <Ic n="bot" size={11} /> {score >= 0.5 ? "injection" : "looks benign"} {score.toFixed(3)}
            </span>
          )}
          {!open && <span className="block truncate text-[12px] text-muted">{m.body}</span>}
        </span>
      </button>
      {open && (
        <textarea value={m.body} onChange={(e) => onEdit(e.target.value)} rows={6}
          className="mx-2.5 mb-2.5 block w-[calc(100%-20px)] rounded-lg border border-line bg-white p-2 text-[12px]" />
      )}
    </div>
  );
}

function AgentSays({ text }: { text: string }) {
  return (
    <li className="anim-fade-up relative flex items-start gap-3">
      <span className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-canvas text-ink-2 ring-4 ring-white"><Ic n="bot" size={18} /></span>
      <span className="mt-1 rounded-2xl rounded-tl-sm bg-canvas px-3.5 py-2 text-[13px] text-ink-2">{text}</span>
    </li>
  );
}

function ToolStep({ s }: { s: Step }) {
  const [open, setOpen] = useState(false);
  const d = describe(s.tool, s.args);
  const st = stepState(s);
  const cs = chips(s);
  return (
    <li className="anim-fade-up relative flex items-start gap-3">
      <span className={`relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full ring-4 ring-white ${st.ring} ${s.status === "waiting" ? "anim-ring" : ""}`}>
        {s.status === "running" ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-ink" /> : <Ic n={d.icon} size={18} />}
        {st.icon && (
          <span className={`absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full text-white ring-2 ring-white ${st.badge}`}>
            <Ic n={st.icon} size={11} />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[14.5px] font-semibold">{d.title}</span>
          {d.sub && <span className="truncate font-mono text-[12.5px] text-ink-2">{d.sub}</span>}
          <span className={`ml-auto shrink-0 text-[11.5px] font-medium ${st.text}`}>{st.label}</span>
          <button type="button" onClick={() => setOpen(!open)} title="Details" aria-label="Details" aria-expanded={open}
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-canvas ${open ? "bg-canvas" : ""}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
          </button>
        </div>
        {cs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {cs.map((c) => (
              <span key={c.text} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${CHIP[c.tone]}`}>
                <Ic n={c.icon} size={12} /> {c.text}
              </span>
            ))}
          </div>
        )}
        {open && (
          <div className="mt-2 space-y-1 border-t border-line pt-2 font-mono text-[11px] text-ink-2">
            <div className="break-all">{s.tool}({fmtArgs(s.args ?? {})})</div>
            {s.reasons?.map((r) => <div key={r} className="text-red">{r}</div>)}
            {s.output && <div className="line-clamp-4 break-all text-muted">{s.output}</div>}
          </div>
        )}
      </div>
    </li>
  );
}

function Outcome({ run }: { run: LiveRun }) {
  const o = run.outcome!;
  const bad = o.kind === "attacker_paid" || o.kind === "data_leaked" || o.kind === "data_destroyed";
  return (
    <div className={`anim-slide-down flex items-center gap-4 rounded-2xl px-5 py-4 text-white ${bad ? "bg-orange" : "bg-blue"}`}>
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15"><Ic n={bad ? "alert" : "shield"} size={30} /></span>
      <div className="min-w-0 flex-1">
        <div className="font-display text-[24px] font-extrabold leading-tight">{o.headline}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {o.detail.slice(0, 3).map((x) => <span key={x} className="rounded-full bg-white/15 px-2.5 py-0.5 text-[12px]">{x}</span>)}
        </div>
      </div>
      <Link href="/audit" title="Signed receipts" className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-[13px] font-medium hover:bg-white/25">
        <Ic n="hash" size={16} /> Receipts
      </Link>
    </div>
  );
}

function LiveApproval({ a, run, inbox, payees, onDone }: {
  a: Approval; run: LiveRun | null; inbox: Email[]; payees: Set<string>; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(() => Math.max(0, Math.round((Date.parse(a.expiresAt) - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.round((Date.parse(a.expiresAt) - Date.now()) / 1000))), 500);
    return () => clearInterval(t);
  }, [a.expiresAt]);
  const decide = async (approve: boolean) => {
    setBusy(true);
    await post(`/api/approvals/${a.id}`, { approve, note: approve ? "approved in dashboard" : "denied in dashboard" }).catch(() => null);
    setBusy(false);
    onDone();
  };
  const d = describe(a.tool, a.args);
  const step = run?.steps.find((s) => s.status === "waiting" && s.tool === a.tool);
  const origin = (step?.provenance ?? []).map((p) => /^(\w+) came from email #(\d+)/.exec(p))
    .find((m): m is RegExpExecArray => !!m && (m[1] === "to_account" || m[1] === "to"));
  const email = origin ? inbox[Number(origin[2]) - 1] : undefined;
  const saved = a.tool === "make_payment" ? payees.has(digits(a.args.to_account)) : null;
  const deny = a.recommended === "deny";
  const total = Math.max(1, Math.round((Date.parse(a.expiresAt) - Date.parse(a.createdAt)) / 1000));

  return (
    <div className="anim-slide-down anim-ring overflow-hidden rounded-2xl border-2 border-amber bg-white">
      <div className="flex items-center gap-2 bg-amber px-4 py-2 text-white">
        <Ic n="user" size={17} />
        <span className="text-[14px] font-semibold">Your call</span>
        <span className="ml-auto flex items-center gap-2 font-mono text-[12px]" title="Unanswered requests are denied">
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-white/30">
            <span className="block h-full bg-white transition-all duration-500" style={{ width: `${(100 * left) / total}%` }} />
          </span>
          {left}s
        </span>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-canvas"><Ic n={d.icon} size={24} /></span>
            <div className="min-w-0">
              <div className="font-display text-[26px] font-extrabold leading-none">{d.title}</div>
              {d.sub && <div className="mt-1 truncate font-mono text-[14px] text-ink-2">{d.sub}</div>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            {a.reasons.some((r) => r.includes("appears nowhere")) && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-soft px-2.5 py-1 font-medium text-red">
                <Ic n="alert" size={13} /> appears nowhere: possibly hallucinated
              </span>
            )}
            {email && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-soft px-2.5 py-1 font-medium text-red">
                <Ic n="mail" size={13} /> came from an email by {email.from}
              </span>
            )}
            {saved !== null && (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${saved ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}>
                <Ic n={saved ? "check" : "x"} size={13} /> {saved ? "a saved payee" : "not a saved payee"}
              </span>
            )}
            {!email && saved === null && a.reasons.slice(0, 1).map((r) => (
              <span key={r} className="inline-flex items-center gap-1.5 rounded-full bg-amber-soft px-2.5 py-1 font-medium text-amber">
                <Ic n="alert" size={13} /> {r.replace(/^\w+: /, "")}
              </span>
            ))}
          </div>
          <div className={`flex items-center gap-1.5 text-[13px] font-semibold ${deny ? "text-red" : "text-green"}`}>
            <Ic n="shield" size={16} /> AgentShield recommends: {deny ? "deny" : "approve"}
          </div>
        </div>
        <div className="flex gap-2 md:flex-col">
          <button type="button" disabled={busy} onClick={() => decide(false)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-6 py-3 text-[15px] font-semibold disabled:opacity-50 ${deny ? "bg-red text-white" : "border border-line bg-white text-red"}`}>
            <Ic n="x" size={18} /> Deny
          </button>
          <button type="button" disabled={busy} onClick={() => decide(true)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-6 py-3 text-[15px] font-semibold disabled:opacity-50 ${deny ? "border border-line bg-white text-ink-2" : "bg-green text-white"}`}>
            <Ic n="check" size={18} /> Approve
          </button>
        </div>
      </div>
    </div>
  );
}

function Panel({ icon, title, children, right }: { icon: string; title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Ic n={icon} size={17} />
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="ml-auto">{right}</span>
      </div>
      {children}
    </div>
  );
}

function Money({ run, payees }: { run: LiveRun | null; payees: Set<string> }) {
  const start = run?.startBalance ?? 250_000;
  const bal = run?.world.balance ?? start;
  const payments = run?.world.payments ?? [];
  const lost = payments.filter((p) => !payees.has(digits(p.to_account))).reduce((n, p) => n + p.amount, 0);
  return (
    <Panel icon="wallet" title="Bank account">
      <div className="font-display text-[30px] font-extrabold leading-none">{fmt(bal)}</div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-canvas">
        <div className={`h-full rounded-full transition-all duration-700 ${lost ? "bg-orange" : "bg-blue"}`} style={{ width: `${(100 * bal) / start}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10.5px] text-muted"><span>0</span><span>{fmt(start)}</span></div>
      {lost > 0 && (
        <div className="anim-pop mt-2 inline-flex items-center gap-1 rounded-full bg-orange px-2.5 py-0.5 text-[12px] font-semibold text-white">
          <Ic n="alert" size={12} /> {fmt(lost)} to an unknown account
        </div>
      )}
      <div className="mt-3 space-y-1.5">
        {payments.map((p, i) => {
          const ok = payees.has(digits(p.to_account));
          return (
            <div key={i} className="anim-fade-up flex items-center gap-2 rounded-lg bg-canvas px-2.5 py-1.5 text-[12.5px]" title={ok ? "A saved payee" : "Not a saved payee"}>
              <span className={ok ? "text-green" : "text-orange"}><Ic n={ok ? "check" : "alert"} size={15} /></span>
              <span className="font-semibold">{fmt(p.amount)}</span>
              <span className="text-muted">→</span>
              <span className="font-mono">{p.to_account}</span>
            </div>
          );
        })}
        {run && !payments.length && <div className="text-[12px] text-muted">no money moved</div>}
      </div>
    </Panel>
  );
}

function Leaks({ run }: { run: LiveRun | null }) {
  const sent = run?.world.sent ?? [];
  return (
    <Panel icon="mail" title="Emails sent"
      right={<span className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${sent.length ? "bg-orange text-white" : "bg-canvas"}`}>{sent.length}</span>}>
      {sent.length ? (
        <div className="space-y-1.5">
          {sent.map((m, i) => (
            <div key={i} className="anim-fade-up flex items-center gap-2 rounded-lg bg-orange-soft px-2.5 py-1.5 text-[12.5px] text-orange">
              <Ic n="alert" size={14} /> <span className="truncate font-mono">{m.to}</span>
            </div>
          ))}
        </div>
      ) : <div className="text-[12px] text-muted">nothing left the account</div>}
    </Panel>
  );
}

function Files({ run }: { run: LiveRun | null }) {
  const files = run?.world.files ?? [];
  return (
    <Panel icon="file" title="Files">
      <div className="flex flex-wrap gap-1.5">
        {files.map((f) => (
          <span key={f.name} title={f.private ? "Private" : undefined}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-mono text-[11.5px] ${f.deleted ? "border-red/30 bg-red-soft text-red line-through" : "border-line bg-white"}`}>
            <Ic n={f.private ? "lock" : "file"} size={12} /> {f.name}
          </span>
        ))}
        {!files.length && <div className="text-[12px] text-muted">3 files, 2 private</div>}
      </div>
    </Panel>
  );
}

function PullRequests({ run }: { run: LiveRun | null }) {
  const prs = run?.world.prs ?? [];
  const leaked = prs.filter((p) => p.leaked.length);
  return (
    <>
      <Panel icon="gitbranch" title="Pull requests"
        right={<span className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${leaked.length ? "bg-orange text-white" : "bg-canvas"}`}>{prs.length}</span>}>
        {prs.length ? (
          <div className="space-y-2">
            {prs.map((p, i) => (
              <div key={i} className={`anim-fade-up rounded-lg px-2.5 py-2 text-[12.5px] ${p.leaked.length ? "bg-orange-soft text-orange" : "bg-canvas"}`}>
                <div className="flex items-center gap-1.5">
                  <Ic n={p.leaked.length ? "alert" : "check"} size={14} />
                  <span className="truncate font-semibold">{p.title}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-ink-2">
                  <Ic n="globe" size={11} /> {p.repo} / {p.path}
                  {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="ml-auto text-blue underline">open</a>}
                </div>
                {p.leaked.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.leaked.map((f) => <span key={f} className="inline-flex items-center gap-1 rounded-md bg-orange px-1.5 py-0.5 font-mono text-[10.5px] text-white"><Ic n="lock" size={10} /> {f}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : <div className="text-[12px] text-muted">{run ? "no pull requests opened" : "nothing opened yet"}</div>}
      </Panel>
      <Panel icon="lock" title="Private code">
        <div className={`flex items-center gap-3 rounded-xl px-3 py-3 ${leaked.length ? "bg-orange text-white" : "bg-green-soft text-green"}`}>
          <Ic n={leaked.length ? "alert" : "lock"} size={22} />
          <span className="text-[14px] font-semibold">
            {leaked.length ? `${new Set(leaked.flatMap((p) => p.leaked)).size} private files now public` : "Still private"}
          </span>
        </div>
      </Panel>
    </>
  );
}

function Claims({ claims }: { claims: { text: string; ok: boolean }[] }) {
  const bad = claims.filter((c) => !c.ok).length;
  return (
    <div className={`card anim-fade-up p-4 ${bad ? "border-red/40" : ""}`}>
      <div className="mb-2.5 flex items-center gap-2">
        <Ic n="hash" size={17} />
        <span className="text-[14px] font-semibold">What the agent said vs what happened</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11.5px] font-medium ${bad ? "bg-red-soft text-red" : "bg-green-soft text-green"}`}>
          {bad ? `${bad} false claim${bad > 1 ? "s" : ""}` : "all true"}
        </span>
      </div>
      <div className="space-y-1.5">
        {claims.map((c, i) => (
          <div key={i} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] ${c.ok ? "bg-canvas" : "bg-red-soft text-red"}`}>
            <Ic n={c.ok ? "check" : "x"} size={14} />
            <span className="truncate">&ldquo;{c.text}&rdquo;</span>
            <span className="ml-auto shrink-0 text-[11.5px] font-medium">{c.ok ? "receipt confirms" : "never happened"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
