/* Charts: hand-built SVG, animated when their slide enters. Square marks, direct labels, hover tooltips. */
const Charts = (() => {
  const axis = (svg, sx, ticks, top, H, unit) => ticks.forEach(t => {
    svgEl(svg, "line", { x1: sx(t), x2: sx(t), y1: top - 4, y2: H - 24, stroke: t === ticks[0] ? C.ink : C.hair, "stroke-width": t === ticks[0] ? 2 : 1 });
    svgEl(svg, "text", { x: sx(t), y: H - 6, "text-anchor": "middle", class: "ax" }, t + unit);
  });

  /* horizontal bars: rows = [{ label, value, color, text, tip }] */
  function hbars(id, rows, { max = 100, labelW = 190, rowH = 38, barH = 20, ticks = [0, 25, 50, 75, 100], unit = "%" } = {}) {
    const svg = document.querySelector(`#${id} svg`);
    const W = +svg.viewBox.baseVal.width, x0 = labelW, x1 = W - 70, sx = v => x0 + (x1 - x0) * v / max;
    const top = 8, H = top + rows.length * rowH + 26;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    axis(svg, sx, ticks, top, H, unit);
    const bars = rows.map((r, i) => {
      const y = top + i * rowH;
      svgEl(svg, "text", { x: 0, y: y + rowH / 2 + 5, class: "lbl" }, r.label);
      const b = svgEl(svg, "rect", { x: x0, y: y + (rowH - barH) / 2, width: 0, height: barH, fill: r.color });
      const v = svgEl(svg, "text", { x: x0 + 8, y: y + rowH / 2 + 5, class: "val" }, r.text ?? r.value + unit);
      hoverTip(svgEl(svg, "rect", { x: 0, y, width: W, height: rowH, class: "hit" }), r.tip || `${r.label}: ${r.text ?? r.value + unit}`);
      const inside = r.value / max > 0.7;   // long bars carry their label inside, right-aligned
      if (inside) { v.setAttribute("text-anchor", "end"); v.setAttribute("style", "fill:#fff"); }
      return { b, v, inside, w: Math.max(sx(r.value) - x0, r.value === 0 ? 3 : 0) };
    });
    return () => bars.forEach((o, i) => {
      gsap.fromTo(o.b, { attr: { width: 0 } }, { attr: { width: o.w }, duration: 1.1, delay: 0.5 + i * 0.09, ease: "power3.out" });
      gsap.fromTo(o.v, { attr: { x: x0 + 8 }, opacity: 0 }, { attr: { x: o.inside ? x0 + o.w - 10 : x0 + o.w + 10 }, opacity: 1, duration: 1.1, delay: 0.5 + i * 0.09, ease: "power3.out" });
    });
  }

  /* dumbbell: rows = [{ label, a, b, tip }] */
  function dumbbell(id, rows, { labelW = 190 } = {}) {
    const svg = document.querySelector(`#${id} svg`);
    const W = +svg.viewBox.baseVal.width, x0 = labelW, x1 = W - 30, sx = v => x0 + (x1 - x0) * v / 100;
    const rowH = 56, top = 14, H = top + rows.length * rowH + 26;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    axis(svg, sx, [0, 20, 40, 60, 80, 100], top, H, "%");
    const parts = rows.map((r, i) => {
      const y = top + i * rowH + rowH / 2;
      svgEl(svg, "text", { x: 0, y: y + 5, class: "lbl" }, r.label);
      const ln = svgEl(svg, "line", { x1: sx(r.a), x2: sx(r.a), y1: y, y2: y, stroke: C.ink, "stroke-width": 3 });
      svgEl(svg, "rect", { x: sx(r.a) - 7, y: y - 7, width: 14, height: 14, fill: C.blue });
      const B = svgEl(svg, "rect", { x: sx(r.a) - 7, y: y - 7, width: 14, height: 14, fill: C.sig });
      svgEl(svg, "text", { x: sx(r.a), y: y - 14, "text-anchor": "middle", class: "val" }, r.a);
      const bt = svgEl(svg, "text", { x: sx(r.b), y: y - 14, "text-anchor": "middle", class: "val" }, r.b);
      const dt = svgEl(svg, "text", { x: (sx(r.a) + sx(r.b)) / 2, y: y + 24, "text-anchor": "middle", class: "ax", style: "fill:#C2360E;font-weight:700" }, `-${r.a - r.b} pts`);
      hoverTip(svgEl(svg, "rect", { x: 0, y: y - rowH / 2, width: W, height: rowH, class: "hit" }), r.tip);
      return { ln, B, bt, dt, r };
    });
    return () => parts.forEach(({ ln, B, bt, dt, r }, i) => {
      const t = gsap.timeline({ delay: 0.55 + i * 0.15 });
      t.fromTo(ln, { attr: { x2: sx(r.a) } }, { attr: { x2: sx(r.b) }, duration: 1, ease: "power3.inOut" })
       .fromTo(B, { attr: { x: sx(r.a) - 7 }, opacity: 0 }, { attr: { x: sx(r.b) - 7 }, opacity: 1, duration: 1, ease: "power3.inOut" }, 0)
       .fromTo([bt, dt], { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.7);
    });
  }

  /* grouped pairs: data = [{ label, sub, a, b }] (a = no defence, b = ours) */
  function pairs(id, data, { labelW = 120 } = {}) {
    const svg = document.querySelector(`#${id} svg`);
    const W = +svg.viewBox.baseVal.width, x0 = labelW, x1 = W - 60, sx = v => x0 + (x1 - x0) * v / 100;
    const gH = 72, top = 10, H = top + data.length * gH + 26;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    axis(svg, sx, [0, 25, 50, 75, 100], top, H, "%");
    const bars = [];
    data.forEach((d, i) => {
      const y = top + i * gH;
      svgEl(svg, "text", { x: 0, y: y + 26, class: "lbl" }, d.label);
      svgEl(svg, "text", { x: 0, y: y + 46, class: "ax" }, d.sub);
      [[d.a, C.blue, 0], [d.b, C.sig, 1]].forEach(([v, c, k]) => {
        const yy = y + 8 + k * 27;
        const b = svgEl(svg, "rect", { x: x0, y: yy, width: 0, height: 20, fill: c });
        const t = svgEl(svg, "text", { x: x0, y: yy + 15, class: "val" }, (v % 1 ? v.toFixed(1) : v) + "%");
        bars.push({ b, t, w: Math.max(sx(v) - x0, 3) });
      });
      hoverTip(svgEl(svg, "rect", { x: 0, y, width: W, height: gH, class: "hit" }), `${d.label}: attack success ${d.a}% to ${d.b}%`);
    });
    return () => bars.forEach((o, i) => {
      gsap.fromTo(o.b, { attr: { width: 0 } }, { attr: { width: o.w }, duration: 1.1, delay: 0.5 + i * 0.1, ease: "power3.out" });
      gsap.fromTo(o.t, { attr: { x: x0 + 8 }, opacity: 0 }, { attr: { x: x0 + o.w + 10 }, opacity: 1, duration: 1.1, delay: 0.5 + i * 0.1, ease: "power3.out" });
    });
  }

  /* range bars: rows = [{ label, lo, hi, color, text }] */
  function ranges(id, rows, { labelW = 190 } = {}) {
    const svg = document.querySelector(`#${id} svg`);
    const W = +svg.viewBox.baseVal.width, x0 = labelW, x1 = W - 40, sx = v => x0 + (x1 - x0) * v / 100;
    const rowH = 46, top = 8, H = top + rows.length * rowH + 26;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    axis(svg, sx, [0, 25, 50, 75, 100], top, H, "%");
    const items = rows.map((r, i) => {
      const y = top + i * rowH;
      svgEl(svg, "text", { x: 0, y: y + 27, class: "lbl" }, r.label);
      const b = svgEl(svg, "rect", { x: sx(r.lo), y: y + 12, width: 0, height: 20, fill: r.color });
      const t = svgEl(svg, "text", { x: sx(r.hi) + 10, y: y + 27, class: "val", "text-anchor": r.hi > 80 ? "end" : "start" }, r.text);
      if (r.hi > 80) { t.setAttribute("x", sx(r.hi) - 10); t.setAttribute("style", "fill:#fff"); }
      hoverTip(svgEl(svg, "rect", { x: 0, y, width: W, height: rowH, class: "hit" }), `${r.label}: ${r.text}`);
      return { b, t, w: sx(r.hi) - sx(r.lo) };
    });
    return () => items.forEach((o, i) => {
      gsap.fromTo(o.b, { attr: { width: 0 } }, { attr: { width: o.w }, duration: 1.2, delay: 0.5 + i * 0.2, ease: "power3.out" });
      gsap.fromTo(o.t, { opacity: 0 }, { opacity: 1, delay: 1.1 + i * 0.2 });
    });
  }
  return { hbars, dumbbell, pairs, ranges };
})();

(() => {
  const util = Charts.dumbbell("cUtil", [
    { label: "MELON", a: 80, b: 68, tip: "MELON (ICML 2025), AgentDojo GPT-4o: 80% to 68%" },
    { label: "CaMeL", a: 84, b: 77, tip: "CaMeL (SaTML 2026): 84% to 77%, about 2.8x tokens" },
    { label: "Progent (replication)", a: 45, b: 27, tip: "Independent Progent replication (Narisetty et al. 2026): 45% to 27%" },
  ]);
  const cost = Charts.hbars("cCost", [
    { label: "No defence", value: 1, color: "#A39C8F", text: "1.0x" },
    { label: "MELON", value: 2, color: C.blue, text: "about 2x", tip: "MELON: masked re-run on every step" },
    { label: "CaMeL", value: 2.8, color: C.blue, text: "about 2.8x", tip: "CaMeL: privileged + quarantined LLM, about 2.8x tokens" },
    { label: "AgentShield", value: 1, color: C.sig, text: "1.0x (rules: 0 calls)", tip: "Contract, provenance and policy are deterministic. Causal replay only for unresolved high-risk calls." },
  ], { max: 3, ticks: [0, 1, 2, 3], unit: "x", labelW: 150, rowH: 44 });
  Deck.register("s-cost", { steps: 0, enter() { util(); cost(); } });

  const det = Charts.hbars("cDetect", [
    { label: "Adaptive attacks vs 12 published defences", value: 90, color: C.blue, text: "over 90% (most)", tip: "Nasr, Carlini et al., USENIX Security 2026" },
    { label: "Heuristic injection detector, InjecAgent", value: 100, color: C.blue, text: "100% (flags 0%)", tip: "Our own heuristic detector flags 0% of InjecAgent injections" },
    { label: "Prompt Guard 2 (ML), our 5 live attacks", value: 100, color: C.blue, text: "100% (flags 0 of 5)", tip: "Meta Llama Prompt Guard 2 (86M) scored all five realistic demo attacks below 0.002" },
    { label: "AgentShield, InjecAgent (1,054 attacks)", value: 0, color: C.sig, text: "0%", tip: "Contract + provenance, fully compromised agent: 0 of 1,054" },
    { label: "AgentShield, adaptive suite (63 attempts)", value: 0, color: C.sig, text: "0 unexplained (9 documented limits)", tip: "63 hand-written bypass attempts: 9 succeed, all documented known limits" },
  ], { labelW: 390, rowH: 40 });
  Deck.register("s-detect", { steps: 0, enter() { det(); } });

  const abl = Charts.hbars("cAbl", [
    { label: "No defence", value: 100, color: "#A39C8F" },
    { label: "Provenance only", value: 9.68, color: C.blue, text: "9.68%" },
    { label: "Intent contract only", value: 0, color: C.blue, text: "0%" },
    { label: "Contract + provenance", value: 0, color: C.sig, text: "0%, zero model calls" },
    { label: "Full AgentShield", value: 0, color: C.sig, text: "0%, 0% false blocks" },
  ], { labelW: 210, rowH: 36 });
  const obf = Charts.ranges("cObf", [
    { label: "Without de-obfuscation", lo: 0, hi: 28, color: C.blue, text: "0% to 28%" },
    { label: "With de-obfuscation", lo: 0, hi: 100, color: C.sig, text: "918 / 918" },
  ], { labelW: 220 });
  const counters = () => document.querySelectorAll("#s-results .cnt").forEach(n => {
    const to = +n.dataset.to, from = +(n.dataset.from || 0), dec = +(n.dataset.dec || 0), o = { v: from };
    n.textContent = from.toFixed(dec);
    gsap.to(o, { v: to, duration: 1.6, delay: 0.5, ease: "power3.out", onUpdate: () => { n.textContent = o.v.toFixed(dec); } });
  });
  Deck.register("s-results", { steps: 0, enter() { abl(); obf(); counters(); } });

  const dojo = Charts.pairs("cDojo", [
    { label: "Banking", sub: "144 attacks", a: 100, b: 4.2 },
    { label: "Slack", sub: "80 attacks", a: 100, b: 35.0 },
  ]);
  const real = Charts.hbars("cReal", [
    { label: "Got past the model", value: 0.19, color: C.blue, text: "2 of 1,054 (0.19%)", tip: "Enhanced setting: the model complied with 2 attacks with no shield" },
    { label: "Got past AgentShield", value: 0, color: C.sig, text: "0, both denied", tip: "Both were denied by the intent contract" },
    { label: "Legit calls blocked", value: 0, color: C.sig, text: "0 of 147", tip: "0 of 147 legitimate calls blocked across both settings" },
    { label: "Final answer given", value: 100, color: C.sig, text: "100%", tip: "Every conversation still produced a final answer" },
  ], { labelW: 200, rowH: 36 });
  Deck.register("s-results2", { steps: 0, enter() { dojo(); real(); } });
})();
