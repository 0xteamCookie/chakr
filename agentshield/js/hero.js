/* Slide 1: title reveal + live decision stream. Slide 2: agent "types" its compliance. */
(() => {
  const h1 = document.getElementById("heroTitle"), word = h1.querySelector(".word");
  word.innerHTML = [...word.textContent].map(c => `<span class="ch">${c}</span>`).join("");
  const chars = h1.querySelectorAll(".ch"), cursor = h1.querySelector(".cur");

  const calls = [
    ["list_issues(acme/website)", "in contract", "allow"],
    ["get_issue(acme/website, 42)", "read; result labelled UNTRUSTED", "allow"],
    ["get_file_contents(acme/payments-core)", "repo outside contract scope", "deny"],
    ["create_pr(acme/website, body=...)", "SECRET source into PUBLIC sink", "deny"],
    ["pay(ACME Supplies, ₹48,000)", "saved payee, TRUSTED", "allow"],
    ["pay(acct 0091 4410 2231, ₹2,40,000)", "account seen only in an email", "ask"],
    ["send_email(to=decoded base64)", "decoded value matches attacker text", "deny"],
    ["read_inbox(unread)", "low-tier read", "allow"],
    ["post(#general, rewritten link)", "causal: survives task masking", "deny"],
    ["sql(select * from integration_tokens)", "not in contract", "deny"],
  ];
  const feed = document.getElementById("feed");
  let n = 0, loop = null, clock = 0;
  const stamp = () => { clock += 37 + Math.floor(Math.random() * 400); const s = 9 * 3600 + 41 * 60 + Math.floor(clock / 1000); return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
  function push(animate) {
    const [c, why, v] = calls[n++ % calls.length];
    const r = document.createElement("div"); r.className = "r";
    r.innerHTML = `<span class="t">${stamp()}</span><span class="c">${c}<small>${why}</small></span><span class="pill ${v}">${v.toUpperCase()}</span>`;
    feed.prepend(r);
    while (feed.children.length > 7) feed.lastElementChild.remove();
    if (animate) {
      gsap.from(r, { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0, duration: 0.5, ease: "power3.out" });
      gsap.from(r.querySelector(".pill"), { scale: 1.6, opacity: 0, duration: 0.35, delay: 0.35, ease: "back.out(2)" });
    }
  }
  for (let i = 0; i < 6; i++) push(false);

  Deck.register("s-hero", {
    steps: 0,
    enter() {
      gsap.fromTo(chars, { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.9, ease: "expo.out", stagger: 0.035, delay: 0.25 });
      gsap.fromTo(cursor, { scaleY: 0 }, { scaleY: 1, transformOrigin: "50% 100%", duration: 0.5, ease: "power3.out", delay: 0.8 });
      gsap.to(cursor, { opacity: 0, duration: 0.01, repeat: -1, yoyo: true, repeatDelay: 0.55, delay: 1.4 });
      loop && loop.kill();
      loop = gsap.timeline({ repeat: -1, delay: 1.2 }).call(() => push(true)).to({}, { duration: 1.6 });
    },
    leave() { loop && loop.kill(); gsap.killTweensOf(cursor); gsap.set(cursor, { opacity: 1 }); },
  });
})();

(() => {
  const msg = "Sure. Reading acme/payments-core and opening a PR with its README and salary.md.";
  const el = document.getElementById("ctxType"), o = { n: 0 };
  let tw = null;
  Deck.register("s-problem", {
    steps: 0,
    enter() {
      el.textContent = ""; o.n = 0; tw && tw.kill();
      tw = gsap.to(o, { n: msg.length, duration: 2.6, ease: "none", delay: 1.1, onUpdate: () => { el.textContent = msg.slice(0, Math.round(o.n)); } });
      gsap.fromTo("#s-problem .ln.evil", { backgroundColor: "#FFFFFF" }, { backgroundColor: "#FFE2D6", duration: 0.8, delay: 0.8 });
      gsap.to("#caret", { opacity: 0, duration: 0.01, repeat: -1, yoyo: true, repeatDelay: 0.5 });
    },
  });
})();
