"use client";

import type { ArgLabel, LayerResult, Verdict } from "@/lib/api";

export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function CardHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[19px] font-semibold tracking-tight">{title}</h2>
        {sub && <p className="mt-0.5 text-[13.5px] text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Kpi({ label, value, unit, note, tone = "ink" }: {
  label: string; value: React.ReactNode; unit?: string; note?: React.ReactNode; tone?: "ink" | "blue" | "orange" | "green";
}) {
  const color = { ink: "text-ink", blue: "text-blue", orange: "text-orange", green: "text-green" }[tone];
  return (
    <div className="card px-5 py-4">
      <div className="text-[13.5px] text-ink-2">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`font-display text-[30px] font-bold leading-none ${color}`}>{value}</span>
        {unit && <span className="kbd">{unit}</span>}
      </div>
      {note && <div className="kbd mt-2">{note}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "md" }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex w-full rounded-xl bg-canvas p-1">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg ${size === "sm" ? "px-2.5 py-1 text-[12.5px]" : "px-3 py-1.5 text-[13.5px]"} transition-all ${value === o.value ? "bg-white font-medium text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1.5">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${checked ? "bg-blue" : "bg-line"}`}>
        <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[19px]" : "left-[3px]"}`} />
      </button>
      <span>
        <span className="block text-[14px] font-medium">{label}</span>
        {hint && <span className="block text-[12.5px] leading-snug text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Slider({ label, hint, value, min, max, step, onChange, format }: {
  label: string; hint?: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string;
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-medium">{label}</span>
        <span className="rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[12px]">{format(value)}</span>
      </div>
      {hint && <p className="mb-2 text-[12.5px] leading-snug text-muted">{hint}</p>}
      <input type="range" className="w-full" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

const VERDICT_STYLE: Record<string, string> = {
  ALLOW: "bg-green-soft text-green",
  DENY: "bg-red-soft text-red",
  ESCALATE: "bg-amber-soft text-amber",
  EXECUTED: "bg-orange-soft text-orange",
  PENDING: "bg-amber-soft text-amber",
};
const VERDICT_TEXT: Record<string, string> = { ALLOW: "Allowed", DENY: "Blocked", ESCALATE: "Needs approval", EXECUTED: "Ran unchecked", PENDING: "Waiting" };

export function VerdictChip({ verdict }: { verdict: Verdict | "EXECUTED" | "PENDING" }) {
  return (
    <span key={verdict} className={`anim-pop inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium ${VERDICT_STYLE[verdict]}`}>
      <VerdictIcon verdict={verdict} />
      {VERDICT_TEXT[verdict]}
    </span>
  );
}

function VerdictIcon({ verdict }: { verdict: string }) {
  if (verdict === "ALLOW") return <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden><path d="m2.5 6.2 2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (verdict === "DENY") return <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden><path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  if (verdict === "EXECUTED") return <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden><path d="M6 2.5v4M6 9h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  return <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden><circle cx="6" cy="6" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M6 4.3V6l1 .8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

const LAYER_NAME: Record<string, string> = {
  contract: "Intent contract", provenance: "Provenance", detector: "Detector", policy: "Policy + tier", causal: "Causal check",
};
const OUTCOME_STYLE: Record<string, string> = {
  pass: "border-green/25 bg-green-soft text-green",
  flag: "border-amber/25 bg-amber-soft text-amber",
  block: "border-red/25 bg-red-soft text-red",
  skip: "border-line bg-canvas text-muted",
};

export function LayerPipeline({ layers }: { layers: LayerResult[] }) {
  const order = ["contract", "provenance", "detector", "policy", "causal"];
  const sorted = [...layers].sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer));
  return (
    <ol className="grid gap-2">
      {sorted.map((l, i) => (
        <li key={l.layer} style={{ animationDelay: `${i * 70}ms` }}
          className={`anim-fade-up flex items-start gap-3 rounded-xl border px-3 py-2 ${OUTCOME_STYLE[l.outcome]}`}>
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/80 font-mono text-[11px] text-ink">{i + 1}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold">
              {LAYER_NAME[l.layer] ?? l.layer}
              <span className="font-mono text-[10.5px] font-normal uppercase tracking-wider opacity-80">{l.outcome}</span>
            </div>
            <div className="break-words text-[12.5px] leading-snug text-ink-2">{l.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

const CONF_STYLE: Record<string, string> = { PUBLIC: "text-ink-2", PRIVATE: "text-amber", SECRET: "text-red" };

export function LabelTable({ labels }: { labels: ArgLabel[] }) {
  if (!labels.length) return <p className="text-[13px] text-muted">No argument labels: the decision was made before provenance ran.</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full text-left text-[12.5px]">
        <thead className="bg-canvas text-[11px] uppercase tracking-wider text-muted">
          <tr><th className="px-3 py-2 font-medium">Argument</th><th className="px-3 py-2 font-medium">Written by</th><th className="px-3 py-2 font-medium">Visibility</th><th className="px-3 py-2 font-medium">Traced to</th></tr>
        </thead>
        <tbody>
          {labels.map((l) => (
            <tr key={l.arg} className="border-t border-line align-top">
              <td className="px-3 py-2 font-mono">{l.arg}</td>
              <td className="px-3 py-2">
                <span className={`inline-flex items-center gap-1.5 font-medium ${l.integrity === "UNTRUSTED" ? "text-orange" : "text-blue"}`}>
                  <span className={`h-2 w-2 rounded-[3px] ${l.integrity === "UNTRUSTED" ? "bg-orange" : "bg-blue"}`} />
                  {l.integrity === "UNTRUSTED" ? "Untrusted" : "Trusted"}
                </span>
              </td>
              <td className={`px-3 py-2 font-medium ${CONF_STYLE[l.confidentiality]}`}>{l.confidentiality.toLowerCase()}</td>
              <td className="px-3 py-2 text-ink-2">
                {l.sources.length ? l.sources.join(", ") : <span className="text-muted">model-generated</span>}
                {l.via && l.via !== "plain" && <div className="font-mono text-[11px] text-orange">via {l.via}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Button({ children, onClick, variant = "dark", disabled, className = "" }: {
  children: React.ReactNode; onClick?: () => void; variant?: "dark" | "light" | "blue" | "danger"; disabled?: boolean; className?: string;
}) {
  const styles = {
    dark: "bg-ink text-white hover:bg-ink/90",
    light: "border border-line bg-white text-ink hover:border-ink/30",
    blue: "bg-blue text-white hover:bg-blue/90",
    danger: "bg-red text-white hover:bg-red/90",
  }[variant];
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-medium transition-all disabled:opacity-50 ${styles} ${className}`}>
      {children}
    </button>
  );
}
