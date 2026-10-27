"use client";

import { useEffect, useMemo, useState } from "react";
import { api, post, fmtArgs, short, useLive, type Approval, type Run, type RunStep, type Scenario, type Settings, type Stats } from "@/lib/api";
import { Button, Card, CardHead, Eyebrow, Kpi, LabelTable, LayerPipeline, Segmented, Slider, Toggle, VerdictChip } from "@/components/ui";
import { ApprovalCard } from "@/components/approval-card";
import { CountUp } from "@/components/motion";

type Preset = "strict" | "balanced" | "permissive";

export default function Console() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [presets, setPresets] = useState<Record<string, Settings> | null>(null);
  const [scenarioId, setScenarioId] = useState("github-issue-leak");
  const [preset, setPreset] = useState<Preset>("balanced");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [runIds, setRunIds] = useState<{ unprotected?: string; protected?: string }>({});
  const [runsById, setRuns] = useState<Record<string, Run>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [picked, setPicked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approvals = useLive<Approval[]>("/api/approvals", ["approval"], 3000);
  const stats = useLive<Stats>("/api/stats", ["receipt", "run"], 5000);

  useEffect(() => {
    api<Scenario[]>("/api/scenarios").then(setScenarios).catch((e) => setError(e.message));
    api<Record<string, Settings>>("/api/presets").then((p) => { setPresets(p); setSettings(p.balanced); }).catch(() => null);
  }, []);

  const sc = scenarios.find((s) => s.id === scenarioId);
  const prot = runIds.protected ? runsById[runIds.protected] : undefined;
  const unprot = runIds.unprotected ? runsById[runIds.unprotected] : undefined;
  const running = [prot, unprot].some((r) => r?.status === "running") || (!!runIds.protected && !prot);

  // poll the active runs until both finish
  useEffect(() => {
    const ids = Object.values(runIds).filter(Boolean) as string[];
    if (!ids.length) return;
    let alive = true;
    const load = async () => {
      const got = await Promise.all(ids.map((id) => api<Run>(`/api/runs/${id}`).catch(() => null)));
      if (!alive) return;
      setRuns((prev) => ({ ...prev, ...Object.fromEntries(got.filter(Boolean).map((r) => [r!.id, r!])) }));
    };
    load();
    const t = setInterval(load, 450);
    return () => { alive = false; clearInterval(t); };
  }, [runIds]);

  // follow the run: show the first blocked step, unless the user picked one
  useEffect(() => {
    if (!prot || picked || !prot.steps.length) return;
    const firstBlock = prot.steps.findIndex((s) => s.decision && s.decision.verdict !== "ALLOW");
    const want = firstBlock >= 0 ? firstBlock : prot.steps.length - 1;
    if (want !== selected) setSelected(want);
  }, [prot, picked, selected]);

  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (presets) setSettings(presets[p]);
  };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => (s ? { ...s, [k]: v } : s));

  const run = async () => {
    if (!settings) return;
    setError(null);
    setSelected(null);
    setPicked(false);
    try {
      const r = await post<{ runs: { mode: "protected" | "unprotected"; id: string }[] }>("/api/runs", {
        scenarioId, mode: "both", preset, overrides: settings,
      });
      setRunIds(Object.fromEntries(r.runs.map((x) => [x.mode, x.id])));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const step = prot && selected !== null ? prot.steps[selected] : undefined;
  const pending = approvals.data ?? [];

  return (
    <div className="grid gap-6 pt-4 lg:grid-cols-[310px_1fr]">
      {/* ------------------------------------------------ sidebar */}
      <aside className="card h-fit p-5 lg:sticky lg:top-6">
        <div className="text-[15px] font-semibold">Scenario</div>
        <p className="kbd mt-0.5">recreated from real incidents</p>
        <div className="mt-3 space-y-1.5">
          {scenarios.map((s) => (
            <button key={s.id} type="button" onClick={() => { setScenarioId(s.id); setRunIds({}); setSelected(null); }}
              className={`w-full rounded-xl border px-3 py-2 text-left transition-all ${s.id === scenarioId ? "border-ink bg-white shadow-sm" : "border-transparent bg-canvas hover:border-line"}`}>
              <div className="flex items-center gap-2 text-[13.5px] font-medium">
                <span className={`h-2 w-2 rounded-[3px] ${s.attack ? "bg-orange" : "bg-blue"}`} />
                {s.title}
              </div>
              <div className="mt-0.5 line-clamp-1 font-mono text-[10.5px] text-muted">{s.basedOn}</div>
            </button>
          ))}
        </div>

        <hr className="my-5 border-line" />
        <Eyebrow className="!text-muted">Preset</Eyebrow>
        <div className="mt-2">
          <Segmented<Preset> value={preset} onChange={choosePreset} options={[
            { value: "strict", label: "Strict" }, { value: "balanced", label: "Balanced" }, { value: "permissive", label: "Permissive" },
          ]} />
        </div>

        {settings && (
          <>
            <hr className="my-5 border-line" />
            <Eyebrow className="!text-muted">Layers</Eyebrow>
            <div className="mt-2">
              <Toggle label="Intent contract" hint="Signed allow-list compiled from the request alone." checked={settings.contract} onChange={(v) => set("contract", v)} />
              <Toggle label="Argument provenance" hint="Trace every value to who wrote it and who may see it." checked={settings.provenance} onChange={(v) => set("provenance", v)} />
              <Toggle label="De-obfuscation" hint="Decode base64, hex, homoglyphs, spelled-out values." checked={settings.deobfuscate} onChange={(v) => set("deobfuscate", v)} />
              <Toggle label="Causal check" hint="Replay with the task masked when rules can't decide." checked={settings.causal} onChange={(v) => set("causal", v)} />
              <Toggle label="Injection detector" hint="Advisory only: can raise risk, never decides." checked={settings.detector} onChange={(v) => set("detector", v)} />
            </div>
            <hr className="my-5 border-line" />
            <Eyebrow className="!text-muted">Tuning</Eyebrow>
            <div className="mt-2">
              <Slider label="Causal similarity" hint="How alike the masked replay must be to count as injection-driven."
                value={settings.causalThreshold} min={0.3} max={0.9} step={0.05} onChange={(v) => set("causalThreshold", v)} format={(v) => v.toFixed(2)} />
              <Slider label="Approval timeout" hint="Unanswered approvals are denied."
                value={settings.approvalTimeoutMs / 1000} min={15} max={300} step={15} onChange={(v) => set("approvalTimeoutMs", v * 1000)} format={(v) => `${v}s`} />
            </div>
          </>
        )}
        <Button className="mt-5 w-full" onClick={run} disabled={!settings || running}>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden><path d="M7 5v14l11-7L7 5Z" fill="currentColor" /></svg>
          {running ? "Running…" : "Run side by side"}
        </Button>
        {error && <p className="mt-3 text-[12.5px] text-red">{error}</p>}
      </aside>

      {/* ------------------------------------------------ main */}
      <div className="min-w-0 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Attacks landed, no shield" value={<CountUp value={stats.data?.harmUnprotected ?? 0} />} tone="orange"
            note={`of ${stats.data?.unprotectedRuns ?? 0} runs`} />
          <Kpi label="Attacks landed, with shield" value={<CountUp value={stats.data?.harmProtected ?? 0} />} tone="blue"
            note={`of ${stats.data?.protectedRuns ?? 0} runs`} />
          <Kpi label="Signed decisions" value={<CountUp value={stats.data?.decisions ?? 0} />} note={`${stats.data?.denied ?? 0} blocked · ${stats.data?.allowed ?? 0} allowed`} />
          <Kpi label="Waiting for a human" value={<CountUp value={pending.length} />} tone={pending.length ? "orange" : "ink"} note={`${stats.data?.approvalsTotal ?? 0} approvals so far`} />
        </div>

        {pending.length > 0 && (
          <div className="grid gap-4 xl:grid-cols-2">
            {pending.map((a) => <div key={a.id} className="anim-slide-down"><ApprovalCard a={a} onDone={approvals.reload} /></div>)}
          </div>
        )}

        <Card className="p-6">
          <CardHead title={sc?.title ?? "Scenario"} sub={sc?.tagline}
            right={sc && <span className="hidden shrink-0 rounded-full bg-canvas px-3 py-1 font-mono text-[11px] text-ink-2 sm:block">{sc.basedOn}</span>} />
          {sc && (
            <div className="mb-5 rounded-xl bg-canvas px-4 py-3">
              <span className="kbd">user task</span>
              <div className="font-mono text-[13.5px]">{sc.task}</div>
            </div>
          )}
          <Lane title="Unprotected agent" color="bg-orange" run={unprot} placeholder="Press Run to replay the attack with no shield." />
          <div className="h-4" />
          <Lane title="With AgentShield" color="bg-blue" run={prot} selected={selected} onSelect={(i) => { setPicked(true); setSelected(i); }}
            placeholder="The same agent, every tool call checked by the shield." />
          {sc && <p className="mt-5 rounded-xl border border-dashed border-line px-4 py-3 text-[13px] text-ink-2"><span className="font-semibold text-ink">Try this: </span>{sc.tryThis}</p>}
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
          <Card className="p-6">
            <CardHead title="Decision inspector" sub="Click any protected step to see how each layer voted." />
            {step ? <div key={`${prot?.id}-${step.index}-${step.decision?.verdict ?? "p"}`} className="anim-fade-in"><Inspector step={step} /></div>
              : <p className="text-[14px] text-muted">Run a scenario to inspect its decisions.</p>}
          </Card>
          <Card className="p-6">
            <CardHead title="Intent contract" sub="Compiled from the user's request before any tool ran." />
            <ContractView run={prot} scenario={sc} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Lane({ title, color, run, placeholder, selected, onSelect }: {
  title: string; color: string; run?: Run; placeholder: string; selected?: number | null; onSelect?: (i: number) => void;
}) {
  return (
    <div className="rounded-2xl bg-canvas p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="flex items-center gap-2 rounded-md bg-white px-2 py-0.5 text-[12.5px] font-medium shadow-sm">
          <span className={`h-2.5 w-2.5 rounded-[3px] ${color}`} />{title}
        </span>
        {run?.status === "done" && <Outcome run={run} />}
      </div>
      {!run ? (
        <p className="px-2 py-5 text-[13.5px] text-muted">{placeholder}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(178px,1fr))] gap-2">
          {run.steps.map((s) => <StepChip key={s.index} s={s} mode={run.mode} active={selected === s.index} onClick={onSelect ? () => onSelect(s.index) : undefined} />)}
          {run.status === "running" && <div className="relative grid min-h-[68px] place-items-center overflow-hidden rounded-xl border border-dashed border-line text-[12px] text-muted"><span className="scan-line" />thinking…</div>}
        </div>
      )}
    </div>
  );
}

function StepChip({ s, mode, active, onClick }: { s: RunStep; mode: Run["mode"]; active?: boolean; onClick?: () => void }) {
  const v = s.decision ? s.decision.verdict : mode === "protected" ? "PENDING" : "EXECUTED";
  const ring = active ? "ring-2 ring-ink" : "";
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`anim-fade-up min-w-0 rounded-xl border border-line bg-white px-3 py-2.5 text-left transition-all ${onClick ? "hover:border-ink/30" : "cursor-default"} ${ring}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10.5px] text-muted">step {s.index + 1}</span>
        <VerdictChip verdict={v} />
      </div>
      <div className="mt-1.5 truncate font-mono text-[12.5px] font-semibold">{s.call.tool}</div>
      <div className="truncate font-mono text-[11px] text-ink-2">{fmtArgs(s.call.args) || "no arguments"}</div>
    </button>
  );
}

function Outcome({ run }: { run: Run }) {
  if (run.harm) return <span className="anim-pop max-w-[60%] truncate rounded-md bg-orange px-2 py-0.5 text-[12px] font-medium text-white" title={run.harm}>{run.harm}</span>;
  return (
    <span className="anim-pop rounded-md bg-blue px-2 py-0.5 text-[12px] font-medium text-white">
      {run.completed ? "No harm · task completed" : "No harm · task not completed"}
    </span>
  );
}

function Inspector({ step }: { step: RunStep }) {
  const d = step.decision;
  if (!d) {
    return (
      <div className="rounded-xl bg-amber-soft px-4 py-4 text-[14px]">
        <div className="font-mono font-semibold">{step.call.tool}</div>
        <div className="break-all font-mono text-[12px] text-ink-2">{fmtArgs(step.call.args)}</div>
        <p className="mt-2 text-ink-2">This call is paused. The shield escalated it to a human: use the approval card above.</p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[15px] font-semibold">{step.call.tool}</div>
          <div className="break-all font-mono text-[12px] text-ink-2">{fmtArgs(step.call.args) || "no arguments"}</div>
        </div>
        <div className="flex items-center gap-2">
          <VerdictChip verdict={d.verdict} />
          <span className="rounded-full bg-canvas px-2 py-0.5 font-mono text-[11px]">risk {d.risk.toLowerCase()}</span>
          <span className="rounded-full bg-canvas px-2 py-0.5 font-mono text-[11px]">{d.latencyMs.toFixed(2)} ms</span>
        </div>
      </div>
      <LayerPipeline layers={d.layers} />
      <div>
        <div className="mb-2 text-[13.5px] font-semibold">Argument provenance</div>
        <LabelTable labels={d.labels} />
      </div>
      {d.causal?.ran && (
        <div className={`rounded-xl px-4 py-3 text-[13px] ${d.causal.injectionDriven ? "bg-red-soft" : "bg-green-soft"}`}>
          <div className="font-semibold">Causal check · similarity {d.causal.similarity}</div>
          <div className="text-ink-2">{d.causal.note}</div>
          {d.causal.replayedCall && <div className="mt-1 font-mono text-[11.5px] text-ink-2">masked replay → {d.causal.replayedCall.tool}({fmtArgs(d.causal.replayedCall.args)})</div>}
        </div>
      )}
      <div className="rounded-xl bg-canvas px-4 py-3">
        <div className="kbd mb-1">{step.executed ? "tool output" : "returned to the agent"}</div>
        <div className="max-h-28 overflow-auto break-all font-mono text-[11.5px] text-ink-2">{step.output}</div>
      </div>
    </div>
  );
}

function ContractView({ run, scenario }: { run?: Run; scenario?: Scenario }) {
  const allow = run?.contract?.allow ?? scenario?.contractPreview ?? [];
  const tools = scenario?.tools ?? [];
  const granted = useMemo(() => new Set(allow.map((a) => a.tool)), [allow]);
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-canvas p-3 font-mono text-[12px]">
        <div className="text-muted">intent-contract.json{run?.contract ? "" : "  (preview)"}</div>
        <div className="mt-1">default: <span className="text-red">deny</span></div>
        {allow.map((r) => (
          <div key={r.tool} className="mt-0.5">
            <span className="text-green">allow</span> {r.tool}{r.scope && <span className="text-ink-2"> where {r.scope.arg} ∈ [{r.scope.values.join(", ")}]</span>}
          </div>
        ))}
        {run?.contract && (
          <div className="mt-2 break-all text-[10.5px] text-muted">sig {short(run.contract.signature.replace("ed25519:", ""), 18)} · compiler {run.contract.compiler}</div>
        )}
      </div>
      <div>
        <div className="mb-2 text-[13.5px] font-semibold">Tools this agent could call</div>
        <div className="flex flex-wrap gap-1.5">
          {tools.map((t) => (
            <span key={t.name} title={t.description}
              className={`rounded-lg border px-2 py-1 font-mono text-[11.5px] ${granted.has(t.name) ? "border-blue/30 bg-blue-soft text-blue" : "border-line bg-white text-muted line-through decoration-muted/50"}`}>
              {t.name}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-muted">Blue tools are granted. Struck-through tools exist but the task never asked for them, so a poisoned input can&apos;t reach them.</p>
      </div>
    </div>
  );
}
