/* Slide 10: architecture v3. Each right-arrow press lights the next group of components:
   an orange border traces around every box in the group, then settles to ink once passed. */
(() => {
  const STEPS = 15;
  const canvas = document.getElementById("canvas");
  const caps = {
    1: ["Agent runtimes", "Any model, any framework: Gemini, Claude, OpenAI, LangChain, MCP clients, benchmark agents, plain HTTP."],
    2: ["Ingress", "The SDK wrappers, MCP proxy or REST API intercept every tool call before it executes."],
    3: ["Trusted control plane", "The contract compiler reads only the user's request, never tool output."],
    4: ["Trusted control plane", "The intent contract is Ed25519-signed and frozen: default deny, narrow-only, widening needs a human."],
    5: ["Decision core", "The normalizer validates schema, session and agent id."],
    6: ["Decision core", "Contract check: is the signature valid, and are this action and its scope in the contract?"],
    7: ["Decision core", "Provenance: every untrusted value is decoded 12 ways, labelled, and traced to who wrote it and who may see it. A high-risk value that appears nowhere is flagged as possibly hallucinated."],
    8: ["Decision core + policy", "Org policy (built-in or OPA) sets the risk tier, LOW to FORBIDDEN. Detectors (Prompt Guard 2 + heuristic) can only raise risk."],
    9: ["Decision core", "Only HIGH-risk calls the rules cannot settle are replayed with the user's task masked."],
    10: ["Decision", "ALLOW, ESCALATE or DENY. A denial returns a structured error to the agent."],
    11: ["Human in the loop", "ESCALATE parks the call behind an explainable card. Approve covers one call; a denial is remembered. No answer means DENY."],
    12: ["Execution plane", "ALLOW forwards the call to the real tool. Raw results go to the labeller, not straight to the agent."],
    13: ["Decision core", "Every result is tagged UNTRUSTED with its confidentiality and fingerprinted for later tracing."],
    14: ["Evidence plane", "Every decision becomes an Ed25519 receipt, hash-chained, verified and anchored on Polygon Amoy. The agent\u2019s claims are checked against them."],
    15: ["Assurance + observability", "Decisions stream to the dashboard, and the engine is measured: InjecAgent, AgentDojo, a real model, adaptive attacks."],
  };

  // groups of boxes per step; the numbered box (data-s) leads its group
  const groups = {};
  canvas.querySelectorAll(".nd[data-g]").forEach(n => {
    const g = +n.dataset.g;
    (groups[g] = groups[g] || []).push(n);
    const ring = document.createElement("span"); ring.className = "ring";
    ring.innerHTML = '<i class="t"></i><i class="r"></i><i class="b"></i><i class="l"></i>';
    n.appendChild(ring); n._ring = ring;
  });
  const lead = {};
  canvas.querySelectorAll(".nd[data-s]").forEach(n => {
    const s = +n.dataset.s; lead[s] = n;
    const b = document.createElement("i"); b.className = "sn"; b.textContent = s; n.appendChild(b);
    groups[s].sort((a, b2) => (a === n ? -1 : b2 === n ? 1 : 0));
  });
  // step 15 has no numbered box in the HTML; badge the dashboard
  { const n = groups[15].find(x => x.querySelector("b").textContent === "Next.js dashboard"); lead[15] = n; const b = document.createElement("i"); b.className = "sn"; b.textContent = 15; n.appendChild(b); }
  const center = n => ({ x: n.offsetLeft + n.offsetWidth / 2, y: n.offsetTop + n.offsetHeight / 2 });

  // orthogonal connectors between consecutive steps' lead boxes
  const wires = document.getElementById("wires"), wireEls = {};
  for (let s = 1; s < 14; s++) {
    const a = center(lead[s]), b = center(lead[s + 1]);
    let d;
    if (s === 2) d = `M${a.x} ${a.y} V202 H${b.x} V${b.y}`;
    else if (s === 4) d = `M${a.x} ${a.y} V${a.y + 26} H426 V${b.y} H${b.x}`;
    else if (s === 10) d = `M${lead[10].offsetLeft} ${a.y} H426 V${b.y} H${b.x}`;
    else if (s === 11) d = `M${a.x} ${a.y} V684 H1058 V${b.y} H${b.x}`;
    else if (s === 12) d = `M${lead[12].offsetLeft} ${a.y} H${b.x}`;
    else if (s === 13) d = `M${a.x} ${a.y} V684 H${b.x} V${b.y}`;
    else d = `M${a.x} ${a.y} V${(a.y + b.y) / 2} H${b.x} V${b.y}`;
    const p = svgEl(wires, "path", { d });
    const L = p.getTotalLength(); p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
    wireEls[s] = p;
  }

  const edges = n => [...n._ring.children];
  gsap.set(canvas.querySelectorAll(".ring .t, .ring .b"), { scaleX: 0 });
  gsap.set(canvas.querySelectorAll(".ring .r, .ring .l"), { scaleY: 0 });

  // trace one box: top, right, bottom, left, like a pen going round it
  const trace = (n, at, tl) => {
    const [t, r, b, l] = edges(n), e = 0.11;
    tl.to(t, { scaleX: 1, duration: e, ease: "none" }, at)
      .to(r, { scaleY: 1, duration: e, ease: "none" }, at + e)
      .to(b, { scaleX: 1, duration: e, ease: "none" }, at + 2 * e)
      .to(l, { scaleY: 1, duration: e, ease: "none" }, at + 3 * e);
  };

  const tl = gsap.timeline({ paused: true });
  tl.addLabel("s0");
  for (let s = 1; s <= STEPS; s++) {
    const start = tl.duration();
    // previous group settles: ring fades, border goes ink
    if (s > 1) {
      const prev = groups[s - 1];
      tl.to(prev.map(n => n._ring), { opacity: 0, duration: 0.25 }, start)
        .to(prev.filter(n => !n.matches(".deny, .allow")), { borderColor: C.ink, borderWidth: 2, duration: 0.25 }, start);
    }
    let at = start + (s > 1 ? 0.15 : 0);
    if (wireEls[s - 1]) { tl.to(wireEls[s - 1], { strokeDashoffset: 0, duration: 0.55, ease: "power2.inOut" }, at); at += 0.4; }
    groups[s].forEach((n, i) => trace(n, at + i * 0.07, tl));
    tl.addLabel("s" + s);
  }

  const no = document.getElementById("capNo"), of = document.getElementById("capOf"), layer = document.getElementById("capLayer"), txt = document.getElementById("capTxt");
  function ui(k) {
    Object.keys(lead).forEach(s => lead[s].classList.toggle("act", +s === k));
    no.textContent = String(k).padStart(2, "0");
    of.textContent = `STEP ${k} OF ${STEPS}  /  ${k ? groups[k].length + " components" : "62 components"}`;
    if (k) { layer.textContent = caps[k][0]; txt.textContent = caps[k][1]; }
    else { layer.textContent = "Overview"; txt.textContent = "Every tool call is checked before it runs. Every decision is signed, chained and anchored on-chain."; }
    gsap.fromTo([no, txt], { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out", stagger: 0.05 });
  }

  let tw = null;
  Deck.register("s-arch", {
    steps: STEPS,
    step(k, instant, back) {
      ui(k);
      tw && tw.kill();
      if (instant) tl.seek("s" + k, false);
      else tw = tl.tweenTo("s" + k, back ? { duration: 0.35 } : {});
    },
  });
})();
