"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ic } from "./icons";
import { NOTES, fetchLive, type Live } from "./data";
import { SLIDES } from "./slides";
import { KF } from "./shared";

export function Deck() {
  const [i, setI] = useState(0);
  const [notes, setNotes] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const n = SLIDES.length;

  const go = useCallback((to: number) => {
    const k = Math.max(0, Math.min(n - 1, to));
    setI(k);
    try { history.replaceState(null, "", `#${k + 1}`); } catch { /* ignore */ }
  }, [n]);

  useEffect(() => {
    const h = parseInt(location.hash.slice(1), 10);
    if (h >= 1 && h <= n) setI(h - 1);
    const onHash = () => { const v = parseInt(location.hash.slice(1), 10); if (v >= 1 && v <= n) setI(v - 1); };
    window.addEventListener("hashchange", onHash);
    fetchLive().then(setLive);
    return () => window.removeEventListener("hashchange", onHash);
  }, [n]);

  useEffect(() => {
    const el = document.documentElement; const prev = el.style.overflow;
    el.style.overflow = "hidden";
    return () => { el.style.overflow = prev; };
  }, []);

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.current?.requestFullscreen?.().catch(() => {});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.matches("input,textarea,select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === "ArrowRight" || k === "PageDown" || (k === " " && !t.closest("button"))) { e.preventDefault(); go(i + 1); }
      else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); go(i - 1); }
      else if (k === "Home") go(0);
      else if (k === "End") go(n - 1);
      else if (k === "f" || k === "F") fullscreen();
      else if (k === "n" || k === "N") setNotes((v) => !v);
      else if (/^[1-9]$/.test(k)) go(parseInt(k, 10) - 1);
      else if (k === "0") go(9);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go, n]);

  return (
    <div ref={root} className="deck fixed inset-0 z-[60] flex flex-col bg-canvas text-ink"
      onTouchStart={(e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; }}
      onTouchEnd={(e) => {
        const s = touch.current; if (!s) return;
        const t = e.changedTouches[0]; const dx = t.clientX - s.x; const dy = t.clientY - s.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(i + (dx < 0 ? 1 : -1));
      }}>
      <style>{KF + CSS}</style>
      <div className="deck-bar h-1 w-full bg-line"><div className="h-full bg-blue transition-[width] duration-500" style={{ width: `${((i + 1) / n) * 100}%` }} /></div>

      <div className="relative min-h-0 flex-1">
        {SLIDES.map((S, k) => (
          <section key={k} className="slide absolute inset-0 overflow-y-auto" data-active={k === i} aria-hidden={k !== i} aria-label={`Slide ${k + 1} of ${n}`}>
            <div className="mx-auto flex min-h-full w-full max-w-[1240px] flex-col justify-center px-5 py-8 sm:px-12">
              <S live={live} active={k === i} />
            </div>
            <p className="print-notes hidden">{NOTES[k]}</p>
          </section>
        ))}
        {notes && (
          <aside className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-[760px] rounded-2xl bg-ink p-4 text-[15px] leading-snug text-white shadow-xl anim-fade-up sm:p-5">
            <div className="kbd mb-1 text-white/60">Speaker notes, slide {i + 1}</div>
            {NOTES[i]}
          </aside>
        )}
      </div>

      <footer className="deck-bar flex items-center justify-between gap-3 px-3 py-2 sm:px-5">
        <Link href="/" className="kbd flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-white" title="Back to the dashboard">
          <Ic n="shield" size={14} /> <span className="hidden sm:inline">AgentShield</span>
        </Link>
        <div className="flex items-center gap-1">
          <button aria-label="Previous slide" onClick={() => go(i - 1)} disabled={i === 0} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white disabled:opacity-30"><Ic n="left" size={18} /></button>
          <div className="hidden gap-1.5 px-2 sm:flex">
            {SLIDES.map((_, k) => (
              <button key={k} aria-label={`Go to slide ${k + 1}`} onClick={() => go(k)}
                className={`h-2 rounded-full transition-all ${k === i ? "w-6 bg-blue" : "w-2 bg-ink/20 hover:bg-ink/40"}`} />
            ))}
          </div>
          <span className="kbd w-12 text-center sm:hidden">{i + 1}/{n}</span>
          <button aria-label="Next slide" onClick={() => go(i + 1)} disabled={i === n - 1} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white disabled:opacity-30"><Ic n="right" size={18} /></button>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setNotes((v) => !v)} aria-pressed={notes} title="Speaker notes (N)" className={`grid h-9 w-9 place-items-center rounded-lg hover:bg-white ${notes ? "bg-white text-blue" : ""}`}><Ic n="note" size={18} /></button>
          <button onClick={fullscreen} title="Fullscreen (F)" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white"><Ic n="expand" size={18} /></button>
        </div>
      </footer>
    </div>
  );
}

const CSS = `
.slide { display: none; }
.slide[data-active="true"] { display: block; animation: fade-in .35s ease both; }
@media print {
  @page { size: 297mm 167mm; margin: 0; }
  html, body { background: #eef1f6 !important; }
  header { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
  .deck { position: static !important; display: block !important; height: auto !important; }
  .deck-bar { display: none !important; }
  .slide { display: block !important; position: relative !important; height: 167mm; overflow: hidden; break-after: page; page-break-after: always; }
  .print-notes { display: block !important; position: absolute; bottom: 4mm; left: 12mm; right: 12mm; font-size: 9px; color: #6b7385; }
  * { animation: none !important; }
}
`;
