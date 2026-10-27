"use client";

import { useState } from "react";
import { useInView } from "./motion";

const SEGS = [
  { key: "blocked", label: "Blocked", color: "#2b4bf2" },
  { key: "escalated", label: "Escalated to a human", color: "#9aa8f7" },
  { key: "executed", label: "Executed", color: "#e2582b" },
] as const;

export interface StackRow { name: string; blocked: number; escalated: number; executed: number }

/** Horizontal stacked bars, one row per category, in the same language as GroupedBars. */
export function StackedBars({ rows }: { rows: StackRow[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const [ref, seen] = useInView<HTMLDivElement>(0.25);
  return (
    <div ref={ref}>
      <div className="mb-4 flex flex-wrap gap-4">
        {SEGS.map((s) => (
          <span key={s.key} className="flex items-center gap-2 text-[13px] text-ink-2">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
      <div className="space-y-4">
        {rows.map((r, ri) => {
          const total = r.blocked + r.escalated + r.executed || 1;
          return (
            <div key={r.name} className="grid grid-cols-[minmax(130px,190px)_1fr] items-center gap-4">
              <div>
                <div className="text-[13.5px] font-medium leading-tight">{r.name}</div>
                <div className="text-[11.5px] leading-tight text-muted">{total} variants</div>
              </div>
              <div className="flex h-[14px] gap-[2px]">
                {SEGS.map((s, si) => {
                  const v = r[s.key];
                  const k = `${r.name}:${s.key}`;
                  if (!v) return null;
                  return (
                    <div key={s.key} className="relative h-full first:rounded-l-[4px] last:rounded-r-[4px]"
                      onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}
                      style={{
                        width: seen ? `${(v / total) * 100}%` : 0, background: s.color,
                        opacity: hover && hover !== k ? 0.35 : 1,
                        transition: `width 900ms cubic-bezier(0.2,0.7,0.2,1) ${ri * 90 + si * 45}ms, opacity 150ms`,
                      }}>
                      {hover === k && (
                        <div className="pointer-events-none absolute left-0 top-[-34px] z-10 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[12px] text-white shadow-lg">
                          {s.label}: <b>{v}</b> of {total}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
