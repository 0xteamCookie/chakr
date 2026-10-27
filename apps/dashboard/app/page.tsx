"use client";

import Link from "next/link";
import { HeroStream } from "@/components/hero-stream";
import { Eyebrow } from "@/components/ui";
import { useLive, type EvalReport } from "@/lib/api";

const STEPS = [
  { title: "Compile the contract", body: "Before the agent reads anything, the user's request alone becomes a signed, frozen allow-list of actions. Injected text can't widen it." },
  { title: "Trace every argument", body: "Each value in a tool call is traced to where it came from, through base64, hex, homoglyphs and spelled-out tricks." },
  { title: "Check policy", body: "Org rules set risk tiers, limits and forbidden actions. Payments and destructive commands always meet a human." },
  { title: "Causal check", body: "Only when rules can't decide: replay the step with the user's task masked. If the action survives, the injection drove it." },
  { title: "Sign the receipt", body: "Every decision becomes an Ed25519-signed receipt in a hash chain, anchored on-chain, so history can't be quietly rewritten." },
];

export default function Home() {
  const { data: ev } = useLive<EvalReport | null>("/api/eval", [], 60_000);
  const report = ev && Array.isArray(ev.configs) ? ev : null;
  const configs = report?.configs ?? [];
  const full = configs.find((c) => c.key === "full");
  const none = configs.find((c) => c.key === "none");
  return (
    <>
      <section className="grid items-center gap-12 pt-10 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
        <div>
          <Eyebrow>Agent firewall · Intent contracts · Provenance</Eyebrow>
          <h1 className="font-display mt-5 text-[44px] font-extrabold leading-[1.02] sm:text-[56px] xl:text-[64px]">
            <span className="whitespace-nowrap">Let agents act.</span>
            <br />
            <span className="whitespace-nowrap text-blue">Not attackers.</span>
          </h1>
          <p className="mt-7 max-w-[560px] text-[18px] leading-relaxed text-ink-2">
            AgentShield sits between your AI agent and its tools. It turns the user&apos;s request into a signed contract,
            traces every argument back to where it came from, and stops actions that were steered by a poisoned issue,
            ticket or email. Every decision is signed and chained.
          </p>
          <Link href="/console"
            className="mt-9 flex max-w-[560px] items-center gap-4 rounded-2xl border-2 border-dashed border-line bg-white/70 p-5 transition-colors hover:border-blue/40">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-blue-soft text-blue">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M7 5v14l11-7L7 5Z" fill="currentColor" /></svg>
            </span>
            <span>
              <span className="block text-[17px] font-semibold">Run a live attack, <span className="text-blue underline underline-offset-4">side by side</span></span>
              <span className="block text-[14px] text-muted">Six scenarios from real 2025 incidents: GitHub MCP, Supabase, invoice fraud and more</span>
            </span>
          </Link>
          <div className="mt-4 flex gap-3">
            <Link href="/evaluation" className="rounded-xl border border-line bg-white px-4 py-2.5 text-[14.5px] font-medium shadow-sm hover:border-ink/30">
              See the evaluation
            </Link>
            <Link href="/audit" className="rounded-xl border border-line bg-white px-4 py-2.5 text-[14.5px] font-medium shadow-sm hover:border-ink/30">
              Verify the audit chain
            </Link>
          </div>
        </div>
        <HeroStream />
      </section>

      <section id="how" className="pt-28">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="font-display mt-4 text-[44px] font-extrabold leading-tight">Five passes, in this order</h2>
        <p className="mt-3 max-w-[760px] text-[17px] leading-relaxed text-ink-2">
          The security comes from deterministic layers that can&apos;t be reworded around. The ML injection score is only an
          extra signal, because adaptive attacks beat 12 published detectors at over 90% success.
        </p>
        <div className="mt-10 grid gap-8 border-t-2 border-blue pt-8 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s, i) => (
            <div key={s.title}>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-ink font-mono text-[12px] font-semibold text-white">{i + 1}</span>
              <h3 className="mt-4 text-[17px] font-semibold">{s.title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pt-28">
        <Eyebrow>Measured, not promised</Eyebrow>
        <h2 className="font-display mt-4 text-[44px] font-extrabold leading-tight">
          {report ? `${report.cases.total.toLocaleString()} real attacks, replayed` : "Real attacks, replayed"}
        </h2>
        <p className="mt-3 max-w-[760px] text-[17px] leading-relaxed text-ink-2">
          We replay every InjecAgent test case through the engine with a fully compromised agent that always tries the
          attacker&apos;s action. That isolates what the shield guarantees on its own, whatever the model.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat big={none ? `${none.asr}%` : "…"} label="attack success, no defence" tone="orange" />
          <Stat big={full ? `${full.asr}%` : "…"} label="attack success, AgentShield" tone="blue" />
          <Stat big={full ? `${full.falseBlockRate}%` : "…"} label="legitimate calls blocked" />
          <Stat big={report ? `${report.latency.p50} ms` : "…"} label="median decision time" />
        </div>
        <Link href="/evaluation" className="mt-6 inline-block text-[15px] font-medium text-blue underline underline-offset-4">
          Full results, ablations and the harder stress test
        </Link>
      </section>
    </>
  );
}

function Stat({ big, label, tone = "ink" }: { big: string; label: string; tone?: "ink" | "blue" | "orange" }) {
  const c = { ink: "text-ink", blue: "text-blue", orange: "text-orange" }[tone];
  return (
    <div className="card px-6 py-5">
      <div className={`font-display text-[40px] font-extrabold leading-none ${c}`}>{big}</div>
      <div className="mt-2 text-[14px] text-ink-2">{label}</div>
    </div>
  );
}
