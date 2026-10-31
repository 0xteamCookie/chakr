"use client";

import { useEffect, useRef, useState } from "react";
import { post, short, useLive, type Receipt, type VerifyReport } from "@/lib/api";
import { Ic } from "@/components/pitch/icons";
import { CountUp } from "@/components/motion";

interface Anchor { id: number; seq: number; head: string; network: string; txHash: string | null; createdAt: string }

const SCAN = "https://amoy.polygonscan.com";

/** Icon for a tool name from any agent (live demo, scenarios, SDK, MCP). */
function toolIcon(tool: string): string {
  if (/pay|transfer|bank/.test(tool)) return "wallet";
  if (/delete|remove|drop/.test(tool)) return "x";
  if (/mail|send|reply|ticket/.test(tool)) return "mail";
  if (/file|repo|readme|csv/.test(tool)) return "file";
  if (/github|pr|issue|comment/.test(tool)) return "gitbranch";
  if (/slack|post/.test(tool)) return "note";
  if (/db|query|sql/.test(tool)) return "box";
  if (/payee|user|contact/.test(tool)) return "user";
  return "terminal";
}
const pretty = (tool: string) => tool.replace(/^[a-z]+\./, "").replace(/_/g, " ");

export default function Audit() {
  const receipts = useLive<Receipt[]>("/api/receipts?limit=60", ["receipt"], 6000);
  const verify = useLive<VerifyReport>("/api/receipts/verify", ["receipt", "anchor"], 6000);
  const anchors = useLive<Anchor[]>("/api/anchors", ["anchor"], 15000);
  const [msg, setMsg] = useState<{ icon: string; text: string; tone: "ok" | "bad" | "info" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const act = async (key: string, path: string, done: (r: any) => { icon: string; text: string; tone: "ok" | "bad" | "info" }) => {
    setBusy(key);
    try { setMsg(done(await post<any>(path, {}))); }
    catch (e) { setMsg({ icon: "alert", text: (e as Error).message, tone: "bad" }); }
    await Promise.all([receipts.reload(), verify.reload(), anchors.reload()]).catch(() => null);
    setBusy(null);
  };

  const v = verify.data;
  const oc = v?.onchain;
  const rows = receipts.data ?? [];
  const last = anchors.data?.find((a) => a.network !== "local") ?? anchors.data?.[0] ?? null;
  const pinned = oc?.status === "ok" ? oc.localSeq ?? null : last?.seq ?? null;

  // flash receipts that arrive while the page is open
  const known = useRef<Set<number> | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!receipts.data) return;
    if (known.current) setFresh(new Set(receipts.data.filter((r) => !known.current!.has(r.seq)).map((r) => r.seq)));
    known.current = new Set(receipts.data.map((r) => r.seq));
  }, [receipts.data]);

  // the database check alone: the local chain recomputes cleanly
  const localOk = v ? v.ok || v.problem === "chain differs from the head anchored on-chain" : null;
  const chainState: { tone: "ok" | "bad" | "wait" | "off"; word: string; note: string } =
    !oc ? { tone: "off", word: "Local only", note: "no blockchain configured" }
    : oc.status === "unreachable" ? { tone: "wait", word: "Offline", note: "blockchain unreachable" }
    : oc.status === "empty" || oc.status === "foreign" ? { tone: "wait", word: "Not anchored yet", note: "press Anchor now" }
    : oc.matches ? { tone: "ok", word: "Matches", note: `receipt #${oc.localSeq ?? "?"} is on-chain` }
    : { tone: "bad", word: "Mismatch", note: "history was rewritten" };

  return (
    <div className="space-y-5 pt-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[34px] font-extrabold leading-none">Audit trail</h1>
          <p className="mt-2 flex items-center gap-2 text-[14px] text-ink-2">
            <Ic n="hash" size={16} /> every decision is signed and chained
            <span className="text-muted">·</span>
            <Ic n="globe" size={16} /> the latest link is written to a public blockchain
          </p>
        </div>
        <div className="font-mono text-[12px] text-muted"><CountUp value={v?.count ?? 0} /> receipts</div>
      </div>

      {/* ------------------------------------------------ two checks */}
      <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        <Status icon="hash" title="Our database" tone={localOk === null ? "wait" : localOk ? "ok" : "bad"}
          word={localOk === null ? "…" : localOk ? "Verified" : "Broken"}
          note={localOk === false ? `receipt #${v?.brokenAt ?? "?"} was edited` : "every hash recomputes"} />
        <div className="hidden items-center justify-center text-muted md:flex"><Ic n="link" size={22} /></div>
        <Status icon="globe" title="Public blockchain" tone={chainState.tone} word={chainState.word} note={chainState.note}
          link={last?.txHash ? `${SCAN}/tx/${last.txHash}` : oc?.contract ? `${SCAN}/address/${oc.contract}` : undefined} />
      </div>

      {/* ------------------------------------------------ actions */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Action icon="globe" title="Anchor now" hint="write the head on-chain" tone="blue" busy={busy === "anchor"}
          onClick={() => act("anchor", "/api/anchor", (r) => ({ icon: "globe", tone: "ok",
            text: r.txHash ? `Receipt #${r.seq} anchored on ${r.network}` : `Receipt #${r.seq} anchored (${r.network})` }))} />
        <Action icon="note" title="Edit one entry" hint="change a DENY to ALLOW" tone="red" busy={busy === "tamper"}
          onClick={() => act("tamper", "/api/demo/tamper", (r) => ({ icon: "alert", tone: "bad", text: `Receipt #${r.seq} edited` }))} />
        <Action icon="alert" title="Rewrite history" hint="edit and recompute every hash" tone="red" busy={busy === "rewrite"}
          onClick={() => act("rewrite", "/api/demo/rewrite", (r) => ({ icon: "alert", tone: "bad", text: `History rewritten from #${r.seq}, ${r.rewritten} hashes recomputed` }))} />
        <Action icon="check" title="Restore" hint="put the real history back" tone="ink" busy={busy === "restore"}
          onClick={() => act("restore", "/api/demo/restore", (r) => ({ icon: "check", tone: "ok", text: `Restored ${r.restored} receipt${r.restored === 1 ? "" : "s"}` }))} />
      </div>
      {msg && (
        <div key={msg.text} className={`anim-fade-up flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium ${msg.tone === "bad" ? "bg-red-soft text-red" : msg.tone === "ok" ? "bg-green-soft text-green" : "bg-canvas text-ink-2"}`}>
          <Ic n={msg.icon} size={16} /> {msg.text}
          {msg.icon === "globe" && last?.txHash && (
            <a href={`${SCAN}/tx/${last.txHash}`} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 underline">Polygonscan <Ic n="right" size={14} /></a>
          )}
        </div>
      )}

      {/* ------------------------------------------------ the chain */}
      <section className="card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Ic n="link" size={18} /><span className="text-[15px] font-semibold">The chain</span>
          <span className="ml-auto flex items-center gap-3 text-[11.5px] text-muted">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green" /> allowed</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red" /> blocked</span>
            <span className="flex items-center gap-1"><Ic n="globe" size={12} /> on-chain</span>
          </span>
        </div>
        <Chain rows={rows.slice(0, 10).reverse()} brokenAt={v?.brokenAt ?? null} pinned={pinned} />
        {!rows.length && <div className="grid place-items-center gap-2 py-8 text-muted"><Ic n="hash" size={32} /><span className="text-[13px]">No receipts yet: run the live agent</span></div>}
      </section>

      {/* ------------------------------------------------ receipts */}
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Ic n="note" size={18} /><span className="text-[15px] font-semibold">Receipts</span>
          <span className="rounded-full bg-canvas px-2 py-0.5 font-mono text-[11px]">{rows.length}</span>
        </div>
        <ul className="divide-y divide-line">
          {(all ? rows : rows.slice(0, 12)).map((r) => <Row key={r.seq} r={r} broken={v?.brokenAt === r.seq} fresh={fresh.has(r.seq)} pinned={pinned === r.seq} />)}
        </ul>
        {rows.length > 12 && (
          <button type="button" onClick={() => setAll(!all)} className="mt-3 w-full rounded-xl bg-canvas py-2 text-[13px] text-ink-2 hover:text-ink">
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ pieces
const TONE = {
  ok: { tile: "border-green/30", icon: "bg-green text-white", word: "text-green", badge: "check" },
  bad: { tile: "border-red/40 anim-shake", icon: "bg-red text-white", word: "text-red", badge: "x" },
  wait: { tile: "border-amber/30", icon: "bg-amber text-white", word: "text-amber", badge: "alert" },
  off: { tile: "border-line", icon: "bg-canvas text-muted", word: "text-ink-2", badge: "" },
};

function Status({ icon, title, tone, word, note, link }: {
  icon: string; title: string; tone: keyof typeof TONE; word: string; note: string; link?: string;
}) {
  const t = TONE[tone];
  return (
    <div key={`${title}-${tone}`} className={`card flex items-center gap-4 border-2 p-5 ${t.tile}`}>
      <span className={`relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${t.icon}`}>
        <Ic n={icon} size={26} />
        {t.badge && <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-white ring-2 ring-white"><span className={t.word}><Ic n={t.badge} size={15} /></span></span>}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-muted">{title}</div>
        <div className={`font-display text-[26px] font-extrabold leading-tight ${t.word}`}>{word}</div>
        <div className="truncate text-[12.5px] text-ink-2">{note}</div>
      </div>
      {link && (
        <a href={link} target="_blank" rel="noreferrer" title="Open on Polygonscan"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line text-ink-2 hover:border-ink/30"><Ic n="right" size={18} /></a>
      )}
    </div>
  );
}

function Action({ icon, title, hint, tone, busy, onClick }: {
  icon: string; title: string; hint: string; tone: "blue" | "red" | "ink"; busy: boolean; onClick: () => void;
}) {
  const c = { blue: "bg-blue-soft text-blue", red: "bg-red-soft text-red", ink: "bg-canvas text-ink" }[tone];
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className="card flex items-center gap-3 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${c}`}>
        {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" /> : <Ic n={icon} size={21} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[14.5px] font-semibold">{title}</span>
        <span className="block truncate text-[11.5px] text-muted">{hint}</span>
      </span>
    </button>
  );
}

function Chain({ rows, brokenAt, pinned }: { rows: Receipt[]; brokenAt: number | null; pinned: number | null }) {
  if (!rows.length) return null;
  return (
    <div className="flex items-center overflow-x-auto pb-2">
      {rows.map((r, i) => {
        const broken = brokenAt !== null && r.seq >= brokenAt;
        const ok = r.verdict === "ALLOW";
        return (
          <div key={`${r.seq}-${broken}`} className="anim-fade-up flex items-center" style={{ animationDelay: `${i * 40}ms` }}>
            <div title={`#${r.seq} ${r.tool}: ${r.verdict}\nhash ${r.hash}`}
              className={`relative flex w-[92px] shrink-0 flex-col items-center gap-1 rounded-2xl border-2 px-2 py-3 transition-colors duration-500 ${broken ? "anim-shake border-red bg-red-soft" : "border-line bg-white"}`}>
              {pinned === r.seq && (
                <span className="absolute -top-2.5 grid h-5 w-5 place-items-center rounded-full bg-blue text-white" title="Anchored on-chain"><Ic n="globe" size={12} /></span>
              )}
              <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-canvas text-ink-2">
                <Ic n={toolIcon(r.tool)} size={18} />
                <span className={`absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full text-white ring-2 ring-white ${ok ? "bg-green" : "bg-red"}`}>
                  <Ic n={ok ? "check" : "x"} size={9} />
                </span>
              </span>
              <span className="font-mono text-[11px] font-semibold">#{r.seq}</span>
              <span className={`font-mono text-[9.5px] ${broken ? "text-red" : "text-muted"}`}>{r.hash.slice(0, 6)}</span>
            </div>
            {i < rows.length - 1 && (
              <div className={`h-[3px] w-5 shrink-0 rounded-full ${brokenAt !== null && rows[i + 1].seq >= brokenAt ? "bg-red" : "bg-blue"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Row({ r, broken, fresh, pinned }: { r: Receipt; broken: boolean; fresh: boolean; pinned: boolean }) {
  const [open, setOpen] = useState(false);
  const ok = r.verdict === "ALLOW";
  const reason = r.payload.reasons?.[0];
  const why = !reason ? null
    : reason.startsWith("contract:") ? "not part of the task"
    : reason.startsWith("provenance:") ? "came from untrusted content"
    : reason.startsWith("reviewer: denied") || /reviewer: denied/.test((r.payload.reasons ?? []).join(" ")) ? "you denied it"
    : reason.startsWith("policy:") ? "needs a human"
    : reason.startsWith("causal:") ? "driven by what it read"
    : null;
  const denied = (r.payload.reasons ?? []).some((x) => x.startsWith("reviewer: denied"));
  return (
    <li className={`${broken ? "bg-red-soft" : fresh ? "anim-flash" : ""} rounded-lg`}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-2 py-2 text-left">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-white ${ok ? "bg-green" : "bg-red"}`}><Ic n={ok ? "check" : "x"} size={14} /></span>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-canvas text-ink-2"><Ic n={toolIcon(r.tool)} size={15} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium capitalize">{pretty(r.tool)}</span>
          {!ok && (why || denied) && <span className="block truncate text-[11.5px] text-red">{denied ? "you denied it" : why}</span>}
        </span>
        {pinned && <span className="text-blue" title="Anchored on-chain"><Ic n="globe" size={15} /></span>}
        {broken && <span className="text-red" title="This receipt was changed"><Ic n="alert" size={15} /></span>}
        <span className="hidden font-mono text-[11px] text-muted sm:block">#{r.seq}</span>
        <span className="hidden font-mono text-[11px] text-muted md:block">{new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </button>
      {open && (
        <div className="space-y-0.5 px-12 pb-2 font-mono text-[11px] text-ink-2">
          <div>agent {r.payload.agentId}</div>
          {(r.payload.reasons ?? []).map((x) => <div key={x}>{x}</div>)}
          <div className="text-muted">hash {short(r.hash, 10)} · prev {short(r.prevHash, 10)}</div>
        </div>
      )}
    </li>
  );
}
