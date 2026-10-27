"use client";

import { useEffect, useRef, useState } from "react";
import { post, short, useLive, type Receipt, type VerifyReport } from "@/lib/api";
import { Button, Card, CardHead, Eyebrow, Kpi, VerdictChip } from "@/components/ui";
import { CountUp } from "@/components/motion";

interface Anchor { id: number; seq: number; head: string; network: string; txHash: string | null; createdAt: string }

export default function Audit() {
  const receipts = useLive<Receipt[]>("/api/receipts?limit=60", ["receipt"], 6000);
  const verify = useLive<VerifyReport>("/api/receipts/verify", ["receipt", "anchor"], 6000);
  const anchors = useLive<Anchor[]>("/api/anchors", ["anchor"], 15000);
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (path: string, done: (r: any) => string) => {
    try {
      const r = await post<any>(path, {});
      setMsg(done(r));
    } catch (e) {
      setMsg((e as Error).message);
    }
    await Promise.all([receipts.reload(), verify.reload(), anchors.reload()]);
  };
  const v = verify.data;
  const rows = receipts.data ?? [];
  // flash receipts that arrive while the page is open
  const known = useRef<Set<number> | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!receipts.data) return;
    if (known.current) setFresh(new Set(receipts.data.filter((r) => !known.current!.has(r.seq)).map((r) => r.seq)));
    known.current = new Set(receipts.data.map((r) => r.seq));
  }, [receipts.data]);

  return (
    <div className="pt-6">
      <Eyebrow>Verifiable audit</Eyebrow>
      <h1 className="font-display mt-4 text-[46px] font-extrabold leading-[1.02]">Every decision, signed and chained</h1>
      <p className="mt-4 max-w-[820px] text-[16px] leading-relaxed text-ink-2">
        Each shield decision is an Ed25519-signed receipt whose hash includes the previous receipt. Change or delete any
        entry and the chain breaks at that exact spot. The head is anchored every five minutes, on a public testnet when configured.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Chain status" value={<span key={String(v?.ok)} className={v ? (v.ok ? "anim-pop inline-block" : "anim-shake inline-block") : ""}>{v ? (v.ok ? "Verified" : "Broken") : "…"}</span>} tone={v?.ok === false ? "orange" : "blue"}
          note={v?.problem ?? <><CountUp value={v?.count ?? 0} /> receipts checked</>} />
        <Kpi label="Head hash" value={<span className="font-mono text-[20px]">{v ? short(v.head, 6) : "…"}</span>} note="SHA-256 of the latest receipt" />
        <Kpi label="Last anchor" value={anchors.data?.[0] ? `#${anchors.data[0].seq}` : "none"} note={anchors.data?.[0] ? `${anchors.data[0].network}${anchors.data[0].txHash ? ` · ${short(anchors.data[0].txHash, 6)}` : ""}` : "anchor now to commit the head"} />
        <Kpi label="Anchor matches chain" value={v?.anchor ? (v.anchor.matches ? "Yes" : "No") : "n/a"} tone={v?.anchor?.matches === false ? "orange" : "ink"} note="recomputed on every check" />
      </div>

      <Card className="mt-6 p-6">
        <CardHead title="Try to rewrite history" sub="The tamper demo edits one stored receipt (turns a DENY into an ALLOW) so you can watch verification fail. Restore puts it back."
          right={
            <div className="flex flex-wrap gap-2">
              <Button variant="light" onClick={() => act("/api/anchor", (r) => `Anchored head at receipt #${r.seq} (${r.network}).`)}>Anchor now</Button>
              <Button variant="danger" onClick={() => act("/api/demo/tamper", (r) => `Tampered with receipt #${r.seq}: ${r.change}.`)}>Simulate tampering</Button>
              <Button variant="dark" onClick={() => act("/api/demo/restore", (r) => `Restored ${r.restored} receipt(s).`)}>Restore</Button>
            </div>
          } />
        {msg && <p key={msg} className="anim-fade-up rounded-xl bg-canvas px-4 py-2.5 font-mono text-[12.5px]">{msg}</p>}
        <ChainStrip rows={rows.slice(0, 8).reverse()} brokenAt={v?.brokenAt ?? null} />
      </Card>

      <Card className="mt-6 p-6">
        <CardHead title="Receipts" sub="Newest first." />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">#</th><th className="py-2 pr-3 font-medium">Time</th><th className="py-2 pr-3 font-medium">Agent</th>
                <th className="py-2 pr-3 font-medium">Tool</th><th className="py-2 pr-3 font-medium">Verdict</th><th className="py-2 pr-3 font-medium">Why</th>
                <th className="py-2 pr-3 font-medium">Hash</th><th className="py-2 pr-3 font-medium">Prev</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.seq} className={`border-b border-line/70 align-top ${v?.brokenAt === r.seq ? "bg-red-soft" : fresh.has(r.seq) ? "anim-flash" : ""}`}>
                  <td className="py-2 pr-3 font-mono">{r.seq}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-ink-2">{new Date(r.createdAt).toLocaleTimeString()}</td>
                  <td className="py-2 pr-3 font-mono text-[12px]">{r.payload.agentId}</td>
                  <td className="py-2 pr-3 font-mono text-[12px]">{r.tool}</td>
                  <td className="py-2 pr-3"><VerdictChip verdict={r.verdict === "ALLOW" ? "ALLOW" : "DENY"} /></td>
                  <td className="max-w-[360px] py-2 pr-3 text-[12px] text-ink-2">{r.payload.reasons?.[0] ?? ""}</td>
                  <td className="py-2 pr-3 font-mono text-[11.5px]">{short(r.hash)}</td>
                  <td className="py-2 pr-3 font-mono text-[11.5px] text-muted">{short(r.prevHash)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="py-6 text-center text-muted">No receipts yet. Run a scenario in the console.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ChainStrip({ rows, brokenAt }: { rows: Receipt[]; brokenAt: number | null }) {
  if (!rows.length) return null;
  return (
    <div className="mt-5 flex items-center gap-0 overflow-x-auto pb-2">
      {rows.map((r, i) => {
        const broken = brokenAt !== null && r.seq >= brokenAt;
        return (
          <div key={`${r.seq}-${broken}`} className="anim-fade-up flex items-center" style={{ animationDelay: `${i * 50}ms` }}>
            <div className={`w-[150px] shrink-0 rounded-xl border px-3 py-2 transition-colors duration-500 ${broken ? "anim-shake border-red bg-red-soft" : "border-line bg-white"}`}>
              <div className="flex items-center justify-between font-mono text-[11px]"><span className="font-semibold">#{r.seq}</span><span className="text-muted">{r.verdict}</span></div>
              <div className="mt-1 truncate font-mono text-[11px] text-ink-2">{r.tool}</div>
              <div className="font-mono text-[10.5px] text-muted">prev {short(r.prevHash, 4)}</div>
              <div className="font-mono text-[10.5px]">hash {short(r.hash, 4)}</div>
            </div>
            {i < rows.length - 1 && <div className={`h-[2px] w-6 shrink-0 ${brokenAt !== null && rows[i + 1].seq >= brokenAt ? "bg-red" : "bg-blue"}`} />}
          </div>
        );
      })}
    </div>
  );
}
