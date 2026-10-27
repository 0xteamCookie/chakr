"use client";

import { useEffect, useState } from "react";
import type { Live } from "./data";

export type SP = { live: Live | null; active: boolean };

export function Head({ title, cap, center = false }: { title: string; cap?: string; center?: boolean }) {
  return (
    <header className={`mb-8 sm:mb-10 ${center ? "text-center" : ""}`}>
      <h2 className="font-display text-balance text-[clamp(2rem,5vw,4rem)] font-bold leading-[1.03] text-ink">{title}</h2>
      {cap && <p className={`mt-3 max-w-[48ch] text-[clamp(1rem,1.6vw,1.375rem)] leading-snug text-ink-2 ${center ? "mx-auto" : ""}`}>{cap}</p>}
    </header>
  );
}

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Loops 0..n-1 while active. With reduced motion it rests on the last step. */
export function useStep(n: number, ms: number, active: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (reducedMotion()) { setS(n - 1); return; }
    setS(0);
    const t = setInterval(() => setS((v) => (v + 1) % n), ms);
    return () => clearInterval(t);
  }, [n, ms, active]);
  return s;
}

export function Tag({ tone, children }: { tone: "blue" | "orange" | "green" | "ink"; children: React.ReactNode }) {
  const c = { blue: "bg-blue-soft text-blue", orange: "bg-orange-soft text-orange", green: "bg-green-soft text-green", ink: "bg-white text-ink-2 border border-line" }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[11.5px] font-medium ${c}`}>{children}</span>;
}

export const btn = "rounded-full px-5 py-2.5 text-[15px] font-medium transition-colors";
export const btnDark = `${btn} bg-ink text-white hover:bg-ink-2`;
export const btnLight = `${btn} border border-line bg-white text-ink hover:border-ink/30`;

export const KF = `
@keyframes hit { 0% { left: 0; opacity: 0; } 12% { opacity: 1; } 48% { left: 44%; opacity: 1; } 56% { left: 44%; opacity: 1; } 72% { left: 28%; opacity: 0; } 100% { left: 28%; opacity: 0; } }
@keyframes cross { 0% { left: 0; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { left: calc(100% - 16px); opacity: 0; } }
@keyframes coin { 0% { left: 2%; opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { left: 94%; opacity: 0; } }
.lane-dot { position: absolute; top: 50%; width: 14px; height: 14px; margin-top: -7px; border-radius: 9999px; }
`;
