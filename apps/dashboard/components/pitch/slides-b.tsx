"use client";

import { useEffect, useMemo, useState } from "react";
import { API } from "@/lib/api";
import { Ic } from "./icons";
import { Head, Tag, btnDark, btnLight, useStep, type SP } from "./shared";
import { MEASURED } from "./data";

/* ------------------------------------------------------------ 6 provenance */
const ADDR = "ops@acme-payroll.co";
const hex = (s: string) => Array.from(s).map((c) => c.charCodeAt(0).toString(16)).join("");
const DIS: { id: string; label: string; shown: string; how: string }[] = [
  { id: "plain", label: "Plain", shown: ADDR, how: "no disguise" },
  { id: "b64", label: "base64", shown: typeof btoa === "function" ? btoa(ADDR) : "b3BzQGFjbWUtcGF5cm9sbC5jbw==", how: "decode base64" },
  { id: "hex", label: "hex", shown: hex(ADDR), how: "decode hex" },
  { id: "look", label: "Lookalike", shown: "ops@acme-payrооl.co", how: "swap lookalike letters" },
];
export function S6({ active }: SP) {
  const [d, setD] = useState(1);
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!active) return;
    setStage(0);
    const ts = [500, 1400, 2300].map((ms, k) => setTimeout(() => setStage(k + 1), ms));
    return () => ts.forEach(clearTimeout);
  }, [d, active]);
  const dis = DIS[d];
  return (
    <div>
      <Head title="Every value remembers where it came from." cap="Disguises don't hide it." />
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Disguise">
        {DIS.map((x, k) => (
          <button key={x.id} onClick={() => setD(k)} aria-pressed={d === k}
            className={`rounded-full px-4 py-2 text-[15px] transition-colors ${d === k ? "bg-ink text-white" : "border border-line bg-white text-ink-2 hover:border-ink/30"}`}>{x.label}</button>
        ))}
      </div>
      <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-2xl border border-line bg-white p-4">
          <div className="mb-2 flex items-center justify-between"><span className="flex items-center gap-2 text-[13px] text-muted"><Ic n="mail" size={16} />Email from a stranger</span><Tag tone="orange">untrusted</Tag></div>
          <p className={`break-all rounded-lg px-2 py-2 font-mono text-[15px] transition-colors duration-500 ${stage >= 3 ? "bg-orange-soft text-orange" : "text-ink-2"}`}>{ADDR}</p>
        </div>
        <div className="grid place-items-center text-center text-[13px] text-ink-2">
          <div className="flex rotate-90 items-center gap-1 md:rotate-0"><Ic n="link" size={22} className={stage >= 3 ? "text-orange" : "text-ink/25"} /></div>
          <span className={`transition-opacity ${stage >= 2 ? "opacity-100" : "opacity-0"}`}>{dis.how}</span>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4">
          <div className="mb-2 flex items-center justify-between"><span className="flex items-center gap-2 text-[13px] text-muted"><Ic n="terminal" size={16} />Tool call</span>
            {stage >= 3 ? <Tag tone="orange">untrusted</Tag> : <Tag tone="ink">checking</Tag>}</div>
          <p className="font-mono text-[13px] text-ink-2">send_email(to:</p>
          <p className={`break-all rounded-lg px-2 py-1.5 font-mono text-[15px] transition-colors duration-500 ${stage >= 3 ? "bg-orange-soft text-orange" : "bg-canvas"}`}>{stage >= 2 ? ADDR : dis.shown}</p>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl bg-white p-4 sm:p-5">
        <span className="flex items-center gap-2 font-mono text-[14px]"><Ic n="key" size={20} className="text-ink" />.env <Tag tone="orange">secret</Tag></span>
        <span className="flex items-center gap-2 text-orange"><Ic n="arrow" size={20} /><Ic n="x" size={20} /></span>
        <span className="flex items-center gap-2 font-mono text-[14px]"><Ic n="globe" size={20} />post_to_web <Tag tone="ink">public</Tag></span>
        <span className="text-[15px] font-medium text-ink">Secrets stay in.</span>
        <span className="ml-auto flex items-center gap-3 text-[12.5px] text-ink-2"><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-blue" />trusted</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-orange" />untrusted</span></span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 7 causal + approval */
export function S7({ active }: SP) {
  const s = useStep(3, 1800, active);
  const [res, setRes] = useState<null | "approve" | "deny">(null);
  return (
    <div>
      <Head title="Hide the task. Does it still happen?" cap="If yes, the task didn't cause it. A human decides." />
      <div className="grid items-center gap-6 md:grid-cols-2">
        <div className="space-y-3 rounded-[24px] border border-line bg-white p-5">
          <Replay label="Task shown" call="make_payment" on={s >= 0} />
          <Replay label="Task hidden" call="make_payment" on={s >= 1} />
          <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-[15px] font-medium transition-all duration-500 ${s >= 2 ? "bg-orange-soft text-orange" : "bg-canvas text-muted"}`}>
            <Ic n="gitbranch" size={20} />{s >= 2 ? "Same call. The task wasn't the cause." : "Comparing…"}
          </div>
        </div>
        <div className="rounded-[24px] border border-line bg-white p-5 shadow-[0_8px_24px_-12px_rgb(11_13_18/0.15)]">
          <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[15px] font-semibold"><Ic n="user" size={18} />Approval needed</span><Tag tone="orange">HIGH risk</Tag></div>
          <p className="mt-3 font-mono text-[14px]">make_payment(to: &quot;9988&quot;, 48000)</p>
          <p className="mt-2 text-[14px] text-ink-2">Why: not part of the task.</p>
          <p className="mt-1 flex items-center gap-2 text-[14px] text-ink-2">Came from: <Ic n="mail" size={15} /> email, Invoice 4471 <Tag tone="orange">untrusted</Tag></p>
          <div className="mt-4 min-h-12" aria-live="polite">
            {res === null ? (
              <div className="flex gap-2">
                <button className={btnDark} onClick={() => setRes("approve")}>Approve</button>
                <button className="rounded-full bg-orange px-5 py-2.5 text-[15px] font-medium text-white hover:opacity-90" onClick={() => setRes("deny")}>Deny</button>
              </div>
            ) : (
              <div className="anim-fade-up flex flex-wrap items-center gap-3">
                <span className={`flex items-center gap-2 font-medium ${res === "deny" ? "text-blue" : "text-amber"}`}>
                  <Ic n={res === "deny" ? "shield" : "alert"} size={20} />{res === "deny" ? "Denied. Logged." : "Approved. Logged with your name."}
                </span>
                <button className={btnLight} onClick={() => setRes(null)}>Reset</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
const Replay = ({ label, call, on }: { label: string; call: string; on: boolean }) => (
  <div className={`flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 transition-opacity duration-500 ${on ? "opacity-100" : "opacity-30"}`}>
    <span className="text-[14px] text-ink-2">{label}</span>
    <span className="flex items-center gap-2 font-mono text-[13.5px]"><Ic n="bot" size={16} />{call}</span>
  </div>
);

/* ------------------------------------------------------------ 8 chain */
const h32 = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
};
type Entry = { tool: string; verdict: string };
const ORIG: Entry[] = [
  { tool: "read_inbox", verdict: "ALLOW" }, { tool: "summarize", verdict: "ALLOW" }, { tool: "make_payment", verdict: "DENY" },
  { tool: "list_issues", verdict: "ALLOW" }, { tool: "add_label", verdict: "ALLOW" }, { tool: "send_email", verdict: "ESCALATE" },
];
const chain = (es: Entry[]) => { const out: string[] = []; es.forEach((e, k) => out.push(h32((out[k - 1] ?? "genesis") + e.tool + e.verdict + k))); return out; };
const CONTRACT = "0x907ad5456ed5abc78060c65f433f679f5a326dba";

export function S8(_: SP) {
  const anchor = useMemo(() => chain(ORIG)[ORIG.length - 1], []);
  const [entries, setEntries] = useState<Entry[]>(ORIG);
  const [stored, setStored] = useState<string[]>(() => chain(ORIG));
  const computed = chain(entries);
  const broken = computed.findIndex((h, k) => h !== stored[k]);
  const localOk = broken === -1;
  const chainMatches = stored[stored.length - 1] === anchor;
  const edit = () => setEntries(ORIG.map((e, k) => (k === 2 ? { ...e, verdict: "ALLOW" } : e)));
  const rewrite = () => {
    const es = ORIG.map((e, k) => (k === 2 ? { ...e, verdict: "ALLOW" } : e));
    setEntries(es); setStored(chain(es));
  };
  const reset = () => { setEntries(ORIG); setStored(chain(ORIG)); };
  return (
    <div>
      <Head title="History you can't quietly rewrite." cap="Edit one entry or all of them. Both get caught." />
      <div className="flex gap-2 overflow-x-auto pb-3" role="list" aria-label="Receipt chain">
        {entries.map((e, k) => {
          const bad = !localOk && k === broken;
          const after = !localOk && k > broken;
          return (
            <div key={k} role="listitem" className="flex shrink-0 items-center gap-2">
              <div className={`w-[8.5rem] rounded-xl border p-3 transition-colors ${bad ? "border-orange bg-orange-soft" : after ? "border-line bg-white opacity-50" : "border-line bg-white"}`}>
                <div className="flex items-center justify-between text-[11px] text-muted"><span>#{k + 1}</span>{bad && <Ic n="x" size={14} className="text-orange" />}</div>
                <div className="mt-1 font-mono text-[13px] font-medium">{e.tool}</div>
                <div className={`font-mono text-[11.5px] ${e.verdict === "DENY" ? "text-blue" : "text-ink-2"}`}>{e.verdict}</div>
                <div className="mt-2 flex items-center gap-1 font-mono text-[11px] text-muted"><Ic n="hash" size={11} />{stored[k].slice(0, 6)}</div>
              </div>
              {k < entries.length - 1 && <Ic n="link" size={16} className={bad || after ? "text-orange" : "text-ink/25"} />}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={btnDark} onClick={edit}>Edit one entry</button>
        <button className={btnDark} onClick={rewrite}>Rewrite the whole chain</button>
        <button className={btnLight} onClick={reset}>Reset</button>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2" aria-live="polite">
        <Check ok={localOk} icon="hash" title="Local check" text={localOk ? "Every link matches." : `Broken at entry #${broken + 1}.`} />
        <Check ok={chainMatches} icon="globe" title="On-chain head (Polygon Amoy)"
          text={chainMatches ? "Matches the saved copy." : "Does not match the public copy."}
          foot={<a className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink" href={`https://amoy.polygonscan.com/address/${CONTRACT}`} target="_blank" rel="noreferrer">{CONTRACT.slice(0, 10)}…{CONTRACT.slice(-6)}</a>} />
      </div>
      <p className="mt-5 flex items-center gap-2 text-[clamp(1rem,1.6vw,1.25rem)] font-medium"><Ic n="lock" size={20} className="text-blue" />Nobody can change it. Not even us.</p>
    </div>
  );
}
function Check({ ok, icon, title, text, foot }: { ok: boolean; icon: string; title: string; text: string; foot?: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border p-4 transition-colors ${ok ? "border-line bg-white" : "border-orange bg-orange-soft"}`}>
      <div className="flex items-center gap-2 text-[14px] font-medium"><Ic n={icon} size={18} />{title}<span className={`ml-auto flex items-center gap-1 ${ok ? "text-green" : "text-orange"}`}><Ic n={ok ? "check" : "x"} size={18} />{ok ? "pass" : "fail"}</span></div>
      <p className="mt-2 text-[15px]">{text}</p>
      {foot && <p className="mt-1 font-mono text-[12px] text-ink-2">{foot}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ 9 results */
function Bar({ label, pct, color, note }: { label: string; pct: number; color: string; note?: string }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 sm:grid-cols-[9rem_1fr_auto]">
      <span className="text-[13.5px] text-ink-2">{label}</span>
      <div className="h-3 rounded-full bg-canvas"><div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(pct, 0.8)}%`, background: color }} /></div>
      <span className="w-24 font-mono text-[14px] font-medium">{pct}%{note && <span className="ml-1 text-[11px] text-muted">{note}</span>}</span>
    </div>
  );
}
export function S9({ live, active }: SP) {
  const total = live?.attacks ?? MEASURED.injecagent.attacks;
  const p50 = live?.p50 ?? MEASURED.p50ms;
  const ad = { ...MEASURED.adaptive, ...(live?.adaptive ?? {}) };
  const [w, setW] = useState(false);
  useEffect(() => { setW(false); if (active) { const t = setTimeout(() => setW(true), 80); return () => clearTimeout(t); } }, [active]);
  const f = (v: number) => (w ? v : 0);
  const L = MEASURED.layers;
  return (
    <div>
      <Head title={`${total.toLocaleString()} attacks. None got through.`} cap={`Measured on InjecAgent, plus ${ad.variants} bypass attempts we wrote ourselves.`} />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-3 rounded-[24px] border border-line bg-white p-5">
          <div className="mb-1 text-[14px] font-medium">Attacks that worked</div>
          <Bar label={L[0].label} pct={f(L[0].asr)} color="#e2582b" />
          <Bar label={L[1].label} pct={f(L[1].asr)} color="#6b7385" />
          <Bar label={L[2].label} pct={f(L[2].asr)} color="#6b7385" />
          <Bar label={L[3].label} pct={f(L[3].asr)} color="#2b4bf2" />
          <div className="!mt-5 border-t border-line pt-4">
            <div className="mb-2 text-[14px] font-medium">Harder test: attacker tools inside the contract</div>
            <Bar label="Contract + provenance" pct={f(MEASURED.stress.contractProvenance)} color="#6b7385" />
            <div className="mt-3"><Bar label="Full AgentShield" pct={f(MEASURED.stress.full)} color="#2b4bf2" /></div>
            <p className="mt-2 flex items-center gap-2 text-[13.5px] text-ink-2"><Ic n="user" size={16} />{MEASURED.stress.escalated} calls sent to a human</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat v="0%" l="normal calls blocked" />
            <Stat v={`${p50} ms`} l="per decision (p50)" />
          </div>
          <div className="rounded-[24px] border border-line bg-white p-5">
            <div className="mb-3 text-[14px] font-medium">{ad.variants} hand-written bypass attempts</div>
            <div className="flex flex-wrap gap-[3px]" role="img" aria-label={`${ad.variants} attempts, ${ad.unexplained} unexplained bypasses, ${ad.known} known limits`}>
              {Array.from({ length: ad.variants }, (_, k) => <i key={k} className={`h-3 w-3 rounded-[3px] ${k < ad.known ? "border-2 border-amber bg-amber-soft" : "bg-blue"}`} />)}
            </div>
            <p className="mt-3 text-[14px]"><b>{ad.unexplained}</b> unexplained bypasses. <span className="text-amber">{ad.known} known limits</span>, published.</p>
          </div>
          <AgentDojoSlot active={active} />
        </div>
      </div>
    </div>
  );
}
const Stat = ({ v, l }: { v: string; l: string }) => (
  <div className="rounded-2xl border border-line bg-white p-4"><div className="font-display text-[clamp(1.5rem,2.6vw,2.2rem)] font-bold leading-none text-blue">{v}</div><div className="mt-1 text-[13px] text-ink-2">{l}</div></div>
);

/* AGENTDOJO SLOT: shows only if GET /api/eval/agentdojo returns
   { suite: string, tasks: number, attackSuccessBaseline: number, attackSuccessShielded: number, utility?: number } (percentages 0-100). */
type Dojo = { suite?: string; tasks?: number; attackSuccessBaseline?: number; attackSuccessShielded?: number; utility?: number };
function AgentDojoSlot({ active }: { active: boolean }) {
  const [d, setD] = useState<Dojo | null>(null);
  useEffect(() => {
    if (!active) return;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    fetch(`${API}/api/eval/agentdojo`, { signal: ctl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setD(j && typeof j.attackSuccessShielded === "number" ? j : null))
      .catch(() => setD(null))
      .finally(() => clearTimeout(t));
    return () => { ctl.abort(); clearTimeout(t); };
  }, [active]);
  if (!d) return null;
  return (
    <div className="rounded-[24px] border border-line bg-white p-5">
      <div className="mb-3 text-[14px] font-medium">AgentDojo{d.suite ? `: ${d.suite}` : ""}{d.tasks ? ` (${d.tasks} tasks)` : ""}</div>
      {typeof d.attackSuccessBaseline === "number" && <Bar label="No defence" pct={d.attackSuccessBaseline} color="#e2582b" />}
      <div className="mt-2"><Bar label="AgentShield" pct={d.attackSuccessShielded!} color="#2b4bf2" /></div>
      {typeof d.utility === "number" && <p className="mt-2 text-[13px] text-ink-2">Useful work still done: {d.utility}%</p>}
    </div>
  );
}

/* ------------------------------------------------------------ 10 close */
export function S10(_: SP) {
  return (
    <div>
      <Head title="Five lines to protect an agent." cap="Works with the tools people already use." />
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <pre className="overflow-x-auto rounded-[24px] bg-ink p-5 font-mono text-[clamp(0.72rem,1.3vw,0.95rem)] leading-relaxed text-white/90"><code>{`import { Shield } from "@agentshield/sdk";

const shield = await Shield.fromRequest(task);
const tools  = shield.wrap(myTools);
await agent.run(tools);`}</code></pre>
        <div className="grid grid-cols-2 gap-3">
          {[["plug", "MCP proxy", "Claude Desktop, Cursor, VS Code"], ["terminal", "Python", "LangChain adapter"], ["box", "Docker", "docker compose up"], ["scale", "Evidence", "for incident reports"]].map(([ic, t, s]) => (
            <div key={t} className="rounded-2xl border border-line bg-white p-4"><Ic n={ic} size={24} className="text-blue" /><div className="mt-2 text-[15px] font-semibold">{t}</div><div className="text-[13px] leading-snug text-ink-2">{s}</div></div>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Need v="6 hours" l="CERT-In incident reporting window" />
        <Need v="250 crore" l="rupees, DPDP 2025 penalty ceiling" />
        <div className="rounded-2xl border border-line bg-white p-4 text-[14px] leading-snug text-ink-2">For banks, software teams and compliance leads. We publish what still gets through.</div>
      </div>
      <p className="mt-8 font-display text-[clamp(1.6rem,3.4vw,2.6rem)] font-bold">Thank you. <span className="text-blue">teamCookie()</span></p>
    </div>
  );
}
const Need = ({ v, l }: { v: string; l: string }) => (
  <div className="rounded-2xl border border-line bg-white p-4"><div className="font-display text-[clamp(1.4rem,2.4vw,2rem)] font-bold leading-none">{v}</div><div className="mt-1 text-[13px] text-ink-2">{l}</div></div>
);
