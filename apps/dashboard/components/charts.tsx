"use client";

import { useState } from "react";
import { useInView } from "./motion";

export interface Series {
  name: string;
  color: string;
  values: number[];
  /** optional extra line per value for the tooltip */
  notes?: string[];
}

/** Grouped horizontal bars. Thin marks, value labels at the bar end, tooltip on hover. */
export function GroupedBars({ categories, series, max = 100, unit = "%", sub }: {
  categories: string[]; series: Series[]; max?: number; unit?: string; sub?: string[];
}) {
  const [hover, setHover] = useState<{ c: number; s: number } | null>(null);
  const [ref, seen] = useInView<HTMLDivElement>(0.25);
  return (
    <div ref={ref}>
      <div className="mb-4 flex flex-wrap gap-4">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-2 text-[13px] text-ink-2">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />{s.name}
          </span>
        ))}
      </div>
      <div className="space-y-4">
        {categories.map((cat, ci) => (
          <div key={cat} className="grid grid-cols-[minmax(130px,190px)_1fr] items-center gap-4">
            <div>
              <div className="text-[13.5px] font-medium leading-tight">{cat}</div>
              {sub?.[ci] && <div className="text-[11.5px] leading-tight text-muted">{sub[ci]}</div>}
            </div>
            <div className="relative space-y-[2px]">
              {series.map((s, si) => {
                const v = s.values[ci];
                const pct = Math.max(0, Math.min(100, (v / max) * 100));
                const on = hover?.c === ci && hover?.s === si;
                const dim = hover && !on;
                return (
                  <div key={s.name} className="relative flex h-[18px] items-center"
                    onMouseEnter={() => setHover({ c: ci, s: si })} onMouseLeave={() => setHover(null)}>
                    <div className="absolute inset-y-0 left-0 right-12 rounded-r-[4px] bg-canvas" />
                    <div className="relative h-[12px] rounded-r-[4px]"
                      style={{
                        width: seen ? `calc((100% - 48px) * ${pct / 100})` : 0, minWidth: seen && v > 0 ? 3 : 0,
                        background: s.color, opacity: dim ? 0.35 : 1,
                        transition: `width 900ms cubic-bezier(0.2,0.7,0.2,1) ${ci * 90 + si * 45}ms, opacity 150ms`,
                      }} />
                    <span className="relative ml-2 font-mono text-[11.5px] text-ink-2 transition-opacity duration-500"
                      style={{ opacity: seen ? 1 : 0, transitionDelay: `${ci * 90 + si * 45 + 500}ms` }}>{fmt(v)}{unit}</span>
                    {on && (
                      <div className="pointer-events-none absolute left-1/3 top-[-38px] z-10 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[12px] text-white shadow-lg">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                        {s.name}: <b>{fmt(v)}{unit}</b>{s.notes?.[ci] ? <span className="text-white/70"> · {s.notes[ci]}</span> : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export interface Point { label: string; x: number; y: number; dx?: number; dy?: number; anchor?: "start" | "end" | "middle" }

/** Scatter of published defences: attack success (x) vs task success under attack (y). Ideal = top-left. */
export function DefenceScatter({ points, color = "#2b4bf2" }: { points: Point[]; color?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 340, L = 52, R = 18, T = 16, B = 44;
  const xMax = 18, yMax = 90;
  const px = (x: number) => L + (x / xMax) * (W - L - R);
  const py = (y: number) => T + (1 - y / yMax) * (H - T - B);
  return (
    <div ref={ref} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Published defences: attack success against task success">
        <rect x={px(0)} y={py(yMax)} width={px(3) - px(0)} height={py(60) - py(yMax)} fill="#e8ecfe" rx="6" />
        <text x={px(0) + 8} y={py(yMax) + 16} className="fill-blue font-mono" fontSize="10.5">where you want to be</text>
        {[0, 15, 30, 45, 60, 75, 90].map((y) => (
          <g key={y}>
            <line x1={L} x2={W - R} y1={py(y)} y2={py(y)} stroke="#e2e6ee" />
            <text x={L - 8} y={py(y) + 4} textAnchor="end" fontSize="10.5" className="fill-muted font-mono">{y}%</text>
          </g>
        ))}
        {[0, 3, 6, 9, 12, 15, 18].map((x) => (
          <text key={x} x={px(x)} y={H - B + 18} textAnchor="middle" fontSize="10.5" className="fill-muted font-mono">{x}%</text>
        ))}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize="11.5" className="fill-ink-2">attack success rate, lower is better</text>
        <text x={12} y={(T + H - B) / 2} textAnchor="middle" fontSize="11.5" className="fill-ink-2" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>task success under attack</text>
        {points.map((p, i) => (
          <g key={p.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
            <circle cx={px(p.x)} cy={py(p.y)} r={hover === i ? 8 : 6} fill={color} stroke="#fff" strokeWidth="2"
              style={{ opacity: seen ? 1 : 0, transform: seen ? "none" : "scale(0.2)", transformOrigin: `${px(p.x)}px ${py(p.y)}px`,
                transition: `all 500ms cubic-bezier(0.2,0.7,0.2,1) ${i * 70}ms` }} />
            <circle cx={px(p.x)} cy={py(p.y)} r="16" fill="transparent" />
            <text x={px(p.x) + (p.dx ?? 10)} y={py(p.y) + (p.dy ?? 4)} textAnchor={p.anchor ?? "start"} fontSize="11.5" className="fill-ink"
              style={{ opacity: seen ? 1 : 0, transition: `opacity 400ms ${i * 70 + 300}ms` }}>{p.label}</text>
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute right-2 top-2 rounded-lg bg-ink px-3 py-2 text-[12px] text-white shadow-lg">
          <b>{points[hover].label}</b>: {points[hover].x}% attacks succeed, {points[hover].y}% tasks done
        </div>
      )}
    </div>
  );
}
