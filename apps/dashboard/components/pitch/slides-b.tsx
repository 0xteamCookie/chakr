"use client";

import { useEffect, useMemo, useState } from "react";
import { Ic } from "./icons";
import { Head, Tag, btnDark, btnLight, type SP } from "./shared";
import { MEASURED } from "./data";

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
        </div>
      </div>
    </div>
  );
}
const Stat = ({ v, l }: { v: string; l: string }) => (
  <div className="rounded-2xl border border-line bg-white p-4"><div className="font-display text-[clamp(1.5rem,2.6vw,2.2rem)] font-bold leading-none text-blue">{v}</div><div className="mt-1 text-[13px] text-ink-2">{l}</div></div>
);

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
