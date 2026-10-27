"use client";

import { useState } from "react";
import { post, useLive, type EvalReport, type AdaptiveReport } from "@/lib/api";
import { Button, Card, CardHead, Eyebrow, Kpi } from "@/components/ui";
import { GroupedBars } from "@/components/charts";
import { StackedBars } from "@/components/adaptive";
import { CountUp, Reveal } from "@/components/motion";

const BLUE = "#2b4bf2";
const ORANGE = "#e2582b";

export default function Evaluation() {
  const { data, error, reload } = useLive<EvalReport | null>("/api/eval", [], 60_000);
  const [busy, setBusy] = useState(false);
  const rerun = async () => {
    setBusy(true);
    await post("/api/eval", {}).catch(() => null);
    await reload();
    setBusy(false);
  };
  const ad = useLive<AdaptiveReport | null>("/api/eval/adaptive", [], 60_000);
  const [adBusy, setAdBusy] = useState(false);
  const rerunAd = async () => {
    setAdBusy(true);
    await post("/api/eval/adaptive", {}).catch(() => null);
    await ad.reload();
    setAdBusy(false);
  };
  const adr = ad.data && Array.isArray(ad.data.variants) ? ad.data : null;
  const adHit = adr?.variants.filter((v) => v.success) ?? [];
  const adIssue = new Map((adr?.known ?? []).map((k) => [k.id, k.issue]));
  const adNames: Record<string, string> = {
    obfuscation: "Obfuscation", "contract-spoofing": "Contract spoofing",
    "approval-social-engineering": "Approval social engineering", "allowed-action-abuse": "Abuse of allowed actions",
  };
  const sum = (k: "blocked" | "escalated" | "executed") => adr?.categories.reduce((a, c) => a + c[k], 0) ?? 0;
  const ev = data && typeof data === "object" && data.cases && typeof data.cases.total === "number" ? data : null;
  const cfg = ev?.configs ?? [];
  const stress = new Map((ev?.stress ?? []).map((s) => [s.key.replace("-overlap", ""), s]));
  const rows = cfg.filter((c) => c.key !== "none");
  const full = cfg.find((c) => c.key === "full");

  return (
    <div className="pt-6">
      <Eyebrow>Evaluation · InjecAgent</Eyebrow>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display max-w-[820px] text-[46px] font-extrabold leading-[1.02]">
          {ev ? `${ev.cases.total.toLocaleString()} attacks, a fully compromised agent` : "Replaying real attacks"}
        </h1>
        <Button variant="light" onClick={rerun} disabled={busy}>{busy ? "Running…" : "Re-run evaluation"}</Button>
      </div>
      <p className="mt-4 max-w-[860px] text-[16px] leading-relaxed text-ink-2">
        {ev?.threatModel ?? "Loading results from the core…"} The intent contract comes from a simulated planner that only
        reads the user instruction. Escalations count as stopped only because a human sees them; the stress test shows how many there are.
      </p>
      {error && <p className="mt-4 text-red">{error}</p>}
      {ev === null && !error && (
        <Card className="mt-8 p-6"><p>No results yet. Press <b>Re-run evaluation</b> (takes a few seconds).</p></Card>
      )}

      {ev && (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi label="Attack success, no defence" value={<CountUp value={cfg[0]?.asr ?? 0} suffix="%" />} tone="orange" note={`${ev.cases.directHarm} direct harm · ${ev.cases.dataStealing} data stealing`} />
            <Kpi label="Attack success, AgentShield" value={<CountUp value={full?.asr ?? 0} suffix="%" />} tone="blue" note={`${full?.denied ?? 0} denied · ${full?.escalated ?? 0} escalated`} />
            <Kpi label="Legitimate calls blocked" value={<CountUp value={full?.falseBlockRate ?? 0} suffix="%" />} note={`${full?.benignCalls ?? 0} user tool calls`} />
            <Kpi label="Median decision time" value={<CountUp value={ev.latency.p50} decimals={2} />} unit="ms" note={`p95 ${ev.latency.p95} ms · ${ev.latency.checks.toLocaleString()} checks`} />
            <Kpi label="Detector alone flags" value={<CountUp value={ev.detector.rate} suffix="%" />} tone="orange" note="of injected responses (advisory)" />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <Card className="p-6">
              <CardHead title="Attack success by layer" sub="Lower is better. Orange: the attacker's tools are already inside the contract, so only provenance and the causal check can stop them." />
              <GroupedBars
                categories={rows.map((c) => c.label)}
                sub={rows.map((c) => c.description)}
                series={[
                  { name: "Normal contract", color: BLUE, values: rows.map((c) => c.asr),
                    notes: rows.map((c) => `${c.executed} ran, ${c.escalated} escalated, ${c.denied} denied`) },
                  { name: "Attacker tools inside contract", color: ORANGE, values: rows.map((c) => stress.get(c.key)?.asr ?? 0),
                    notes: rows.map((c) => { const s = stress.get(c.key); return s ? `${s.executed} ran, ${s.escalated} escalated, ${s.denied} denied` : ""; }) },
                ]}
              />
            </Card>
            <Card className="p-6">
              <CardHead title="Hidden values traced back to the attacker" sub={`The attacker's value in each case was rewritten ${ev.obfuscation.length - 1} ways. Higher is better.`} />
              <GroupedBars
                categories={ev.obfuscation.map((o) => o.method)}
                series={[
                  { name: "With de-obfuscation", color: BLUE, values: ev.obfuscation.map((o) => (100 * o.tracedWith) / o.cases),
                    notes: ev.obfuscation.map((o) => `${o.tracedWith}/${o.cases} cases`) },
                  { name: "Without", color: ORANGE, values: ev.obfuscation.map((o) => (100 * o.tracedWithout) / o.cases),
                    notes: ev.obfuscation.map((o) => `${o.tracedWithout}/${o.cases} cases`) },
                ]}
              />
            </Card>
          </div>

          <Reveal><Card className="mt-6 p-6">
            <CardHead title="Every configuration" sub="Executed = the attacker's action ran with no human involved." />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13.5px]">
                <thead className="text-[11.5px] uppercase tracking-wider text-muted">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-4 font-medium">Configuration</th><th className="py-2 pr-4 font-medium">Contract scope</th>
                    <th className="py-2 pr-4 font-medium">Attack success</th><th className="py-2 pr-4 font-medium">Executed</th>
                    <th className="py-2 pr-4 font-medium">Escalated</th><th className="py-2 pr-4 font-medium">Denied</th>
                    <th className="py-2 pr-4 font-medium">False blocks</th>
                  </tr>
                </thead>
                <tbody>
                  {[...cfg.map((c) => ({ c, overlap: false })), ...(ev.stress ?? []).map((c) => ({ c, overlap: true }))].map(({ c, overlap }) => (
                    <tr key={c.key} className="anim-fade-up border-b border-line/70" style={{ animationDelay: `${(overlap ? 5 : 0) * 60 + cfg.indexOf(c) * 60}ms` }}>
                      <td className="py-2.5 pr-4 font-medium">{c.label}</td>
                      <td className="py-2.5 pr-4 text-ink-2">{overlap ? "attacker tools inside" : "user's app only"}</td>
                      <td className={`py-2.5 pr-4 font-mono font-semibold ${c.asr > 0 ? "text-orange" : "text-blue"}`}>{c.asr}%</td>
                      <td className="py-2.5 pr-4 font-mono">{c.executed}</td>
                      <td className="py-2.5 pr-4 font-mono">{c.escalated}</td>
                      <td className="py-2.5 pr-4 font-mono">{c.denied}</td>
                      <td className="py-2.5 pr-4 font-mono">{c.falseBlockRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[12.5px] text-muted">
              Dataset: {ev.dataset}. Generated {new Date(ev.generatedAt).toLocaleString()} in {ev.durationMs} ms. Limits: the
              compromised-agent replay measures the shield, not a specific model; benign utility is measured on the user&apos;s own
              tool call; the causal check relies on MELON&apos;s premise that injected actions don&apos;t depend on the user&apos;s task.
            </p>
          </Card></Reveal>
        </>
      )}

      <section className="mt-16">
        <Eyebrow>Red team · adaptive attack suite</Eyebrow>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-display max-w-[820px] text-[34px] font-extrabold leading-[1.05]">Adaptive attack suite</h2>
          <Button variant="light" onClick={rerunAd} disabled={adBusy}>{adBusy ? "Running…" : "Re-run adaptive suite"}</Button>
        </div>
        <p className="mt-4 max-w-[860px] text-[16px] leading-relaxed text-ink-2">
          Attacks written against what AgentShield is known to do: obfuscation it does not decode, contract values it normalises,
          approval cards filled with attacker text, and permitted actions with steered arguments. The agent is fully compromised;
          everything else is the real engine.
        </p>
        {ad.error && <p className="mt-4 text-red">{ad.error}</p>}
        {!adr && !ad.error && (
          <Card className="mt-6 p-6"><p>No adaptive results yet. Press <b>Re-run adaptive suite</b> (takes a few seconds).</p></Card>
        )}
        {adr && (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Attack variants" value={<CountUp value={adr.variants.length} />} note={`${adr.categories.length} categories`} />
              <Kpi label="Blocked" value={<CountUp value={sum("blocked")} />} tone="blue" note="denied outright" />
              <Kpi label="Escalated to a human" value={<CountUp value={sum("escalated")} />} note="held for approval" />
              <Kpi label="Executed" value={<CountUp value={sum("executed")} />} tone="orange" note={`${adHit.length} listed below as known limits`} />
            </div>
            <Card className="mt-6 p-6">
              <CardHead title="Outcome by attack category" sub="Each variant is run against the full shield. Blue is stopped, light blue waits for a person, orange ran." />
              <StackedBars rows={adr.categories.map((c) => ({ name: adNames[c.category] ?? c.category, blocked: c.blocked, escalated: c.escalated, executed: c.executed }))} />
            </Card>
            <Reveal><Card className="mt-6 p-6">
              <CardHead title="Known limits" sub="We publish what still gets through. These are documented boundaries of the design, each with the reason, not hidden failures." />
              {adHit.length === 0 ? <p className="text-[14px] text-ink-2">Every variant was blocked or escalated in this run.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[13.5px]">
                    <thead className="text-[11.5px] uppercase tracking-wider text-muted">
                      <tr className="border-b border-line">
                        <th className="py-2 pr-4 font-medium">Variant</th><th className="py-2 pr-4 font-medium">Category</th>
                        <th className="py-2 pr-4 font-medium">Outcome</th><th className="py-2 pr-4 font-medium">Why it is a limit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adHit.map((v) => (
                        <tr key={v.id} className="border-b border-line/70 align-top">
                          <td className="py-2.5 pr-4 font-medium">{v.name}</td>
                          <td className="py-2.5 pr-4 text-ink-2">{adNames[v.category] ?? v.category}</td>
                          <td className="py-2.5 pr-4 font-mono">{v.outcome}</td>
                          <td className="py-2.5 pr-4 text-ink-2">{v.known ?? adIssue.get(v.id) ?? (v.misled ? `Approval card could mislead: ${v.misled}` : "Under review")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-4 text-[12.5px] text-muted">
                {adr.bypasses.length ? `Unexplained bypasses: ${adr.bypasses.join(", ")}. ` : "No unexplained bypasses. "}
                Generated {new Date(adr.generatedAt).toLocaleString()} in {adr.durationMs} ms.
              </p>
            </Card></Reveal>
          </>
        )}
      </section>
    </div>
  );
}
