/* Slide 4: GitHub MCP attack, 11 builds (5 without the shield, 6 with it). Slide 5: case wires. */
(() => {
  const D = { sig: "#FF5A26", ok: "#2BD46F", bone: "#F4F1EA", ink: "#0B0B0C", muted: "#9A958B", panel: "#151513" };
  const without = [
    ["Dev asks: <code>look at the open issues in acme/website</code>", "bad"],
    ["Agent reads issue #42. The attacker's text enters its context.", "bad"],
    ["Agent reads <code>acme/payments-core</code>, a private repo.", "bad"],
    ["Agent calls <code>create_pr(acme/website, body=&lt;private files&gt;)</code>", "bad"],
    ["Private code is now public. Nobody approved it.", "bad"],
  ];
  const withS = [
    ["The request is compiled into a signed contract before anything untrusted is read.", "good"],
    ["Issue #42 is read (allowed). The result is labelled <code>UNTRUSTED</code>.", "good"],
    ["<code>get_file_contents(acme/payments-core)</code> is not in the contract. Denied.", "good"],
    ["Even with a wider contract: the PR body traces to a SECRET source and the sink is PUBLIC. Denied.", "good"],
    ["Nothing leaves. Both decisions are signed receipts on the hash chain.", "good"],
  ];
  const verdicts = {
    5: `<span style="color:${D.sig}">LEAKED</span>&nbsp; PR #43 now contains salary.md and relocation plans`,
    9: `<span style="color:${D.sig}">DENY</span>&nbsp; get_file_contents: repo outside contract scope`,
    10: `<span style="color:${D.sig}">DENY</span>&nbsp; provenance: SECRET flowing into a PUBLIC sink`,
    11: `<span style="color:${D.ok}">SAFE</span>&nbsp; 2 receipts signed, chain head anchored`,
  };
  const list = document.getElementById("stepList");
  let mode = -1;
  function ui(k) {
    const m = k >= 6 ? 1 : 0;
    if (m !== mode) {
      mode = m;
      list.innerHTML = (m ? withS : without).map((s, i) => `<li class="${s[1]}"><span class="n">0${i + 1}</span><span>${s[0]}</span></li>`).join("");
      document.getElementById("mA").classList.toggle("on", !m);
      document.getElementById("mB").classList.toggle("on", !!m);
      document.getElementById("flowTitle").textContent = m ? "With AgentShield, the same attack goes nowhere" : "Without a checkpoint, private code goes public";
      document.getElementById("stepsHd").textContent = m ? "WHAT AGENTSHIELD DOES" : "WHAT THE AGENT DOES";
    }
    const n = m ? Math.max(0, k - 6) : k;
    list.querySelectorAll("li").forEach((li, i) => { li.classList.toggle("on", i < n); li.classList.toggle("cur", i === n - 1); });
    document.getElementById("stepNo").textContent = n + " / 5";
    document.getElementById("verdict").innerHTML = verdicts[k] || "&nbsp;";
  }

  const P = (x, y) => ({ attr: { x: x - 8, y: y - 8 } });
  const path = (pts, d = 1.3) => ({ keyframes: pts.map(p => ({ ...P(p[0], p[1]), duration: d / pts.length })), ease: "none" });
  const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.inOut", duration: 0.9 } });
  gsap.set(["#p1", "#p2", "#p3", "#p4"], { opacity: 0 });
  tl.addLabel("k0")
    // 1. dev -> agent
    .set("#p1", { opacity: 1, ...P(130, 300) }).to("#p1", P(340, 300)).addLabel("k1")
    // 2. issue -> agent, agent compromised
    .to("#p1", { opacity: 0, duration: 0.2 })
    .set("#p2", { opacity: 1, ...P(690, 120) }).to("#p2", path([[610, 120], [610, 280], [540, 280]]))
    .to("#agentBox", { attr: { fill: D.sig }, duration: 0.4 }).addLabel("k2")
    // 3. private -> agent
    .set("#p3", { opacity: 1, ...P(690, 300) }).to("#p3", P(540, 300)).addLabel("k3")
    // 4. agent -> PR
    .set("#p4", { opacity: 1, ...P(540, 320) }).to("#p4", path([[610, 320], [610, 480], [690, 480]])).addLabel("k4")
    // 5. leak
    .to("#prLeak", { opacity: 0.55, duration: 0.5 })
    .to("#prBox", { attr: { stroke: D.sig, "stroke-width": 3 }, duration: 0.4 }, "<")
    .to("#prTxt", { attr: { fill: D.sig }, duration: 0.4 }, "<").addLabel("k5")
    // 6. reset, shield rises
    .to(["#p2", "#p3", "#p4", "#prLeak"], { opacity: 0, duration: 0.3 })
    .to("#prBox", { attr: { stroke: D.bone, "stroke-width": 1.5 }, duration: 0.3 }, "<")
    .to("#prTxt", { attr: { fill: D.muted }, duration: 0.3 }, "<")
    .to("#agentBox", { attr: { fill: D.bone }, duration: 0.3 }, "<")
    .set("#shield", { opacity: 1 })
    .fromTo("#shieldBar", { attr: { y: 300, height: 0 } }, { attr: { y: 40, height: 520 }, duration: 0.8, ease: "expo.out", immediateRender: false }).addLabel("k6")
    // 7. dev -> agent, contract compiled
    .set("#p1", { opacity: 1, ...P(130, 300) }).to("#p1", P(340, 300))
    .fromTo("#contract", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, immediateRender: false }, "<0.3").addLabel("k7")
    // 8. issue read (allowed), labelled untrusted
    .to("#p1", { opacity: 0, duration: 0.2 })
    .set("#p2", { opacity: 1, ...P(690, 120) })
    .to("#untrust", { opacity: 1, duration: 0.3 })
    .to("#p2", path([[610, 120], [610, 280], [540, 280]])).addLabel("k8")
    // 9. private read -> blocked at shield
    .to("#p2", { opacity: 0, duration: 0.2 })
    .set("#p3", { opacity: 1, ...P(540, 300) }).to("#p3", P(584, 300), "+=0.05")
    .to("#p3", { opacity: 0, duration: 0.25 })
    .fromTo("#deny1", { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.35, immediateRender: false }, "<").addLabel("k9")
    // 10. PR -> blocked
    .set("#p4", { opacity: 1, ...P(540, 320) }).to("#p4", P(584, 320))
    .to("#p4", { opacity: 0, duration: 0.25 })
    .fromTo("#deny2", { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.35, immediateRender: false }, "<").addLabel("k10")
    // 11. safe
    .to(["#privBox", "#prBox"], { attr: { stroke: D.ok, "stroke-width": 3 }, duration: 0.4 }).addLabel("k11");

  let tw = null;
  Deck.register("s-flow", {
    steps: 11,
    step(k, instant, back) {
      ui(k);
      tw && tw.kill();
      if (instant) tl.seek("k" + k, false);
      else tw = tl.tweenTo("k" + k, back ? { duration: 0.45, ease: "power2.inOut" } : {});
    },
  });
})();

/* Slide 5: packets ride each case's wire */
(() => {
  const loops = [];
  document.querySelectorAll("#s-cases .wire i").forEach((dot, i) => {
    loops.push(gsap.fromTo(dot, { left: 0 }, { left: "calc(100% - 12px)", duration: 1.5, ease: "power1.inOut", repeat: -1, repeatDelay: 0.9, delay: i * 0.15, paused: true }));
  });
  Deck.register("s-cases", {
    steps: 0,
    enter() { loops.forEach(l => l.restart(true)); },
    leave() { loops.forEach(l => l.pause()); },
  });
})();
