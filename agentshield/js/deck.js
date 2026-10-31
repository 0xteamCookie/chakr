/* Deck engine: fixed 1600x900 slides scaled to fit, arrow-key navigation,
   per-slide build steps (like PowerPoint animations), overview scrolled with Lenis. */
const C = { sig: "#E8441A", blue: "#2547F4", ink: "#0B0B0C", muted: "#5E5A52", hair: "#E4DED2", bone: "#F4F1EA" };
const NS = "http://www.w3.org/2000/svg";

const Deck = (() => {
  const slides = [...document.querySelectorAll(".slide")];
  const mods = {};          // id -> { steps, enter(dir), leave(), step(k, instant) }
  let cur = -1, step = 0, busy = null;

  const fit = () => {
    const s = Math.min(innerWidth / 1600, innerHeight / 900);
    document.documentElement.style.setProperty("--s", s);
  };
  addEventListener("resize", fit); fit();

  // chrome
  const segs = document.getElementById("segs");
  slides.forEach(() => segs.appendChild(document.createElement("i")));
  const pad = n => String(n).padStart(2, "0");
  const chrome = () => {
    document.getElementById("chromeNo").textContent = pad(cur + 1) + " / " + pad(slides.length);
    document.getElementById("chromeTitle").textContent = slides[cur].dataset.title;
    [...segs.children].forEach((x, i) => x.classList.toggle("done", i <= cur));
    history.replaceState(null, "", "#" + (cur + 1));
  };

  const modOf = i => mods[slides[i].id] || { steps: 0 };
  const items = el => el.querySelectorAll("[data-a]");

  function show(i, dir) {
    if (i < 0 || i >= slides.length || i === cur) return;
    if (busy) busy.progress(1);
    const from = slides[cur], to = slides[i], prevMod = cur >= 0 ? modOf(cur) : null;
    prevMod && prevMod.leave && prevMod.leave();
    cur = i; chrome();
    const m = modOf(i);
    step = dir < 0 ? m.steps : 0;

    to.classList.add("on"); to.style.zIndex = 2;
    const tl = gsap.timeline({ onComplete: () => { busy = null; } });
    busy = tl;
    if (from) {
      from.style.zIndex = 1;
      tl.to(from.querySelector(".frame"), { x: -60 * dir, opacity: 0.25, duration: 0.7, ease: "power3.inOut" }, 0)
        .call(() => { from.classList.remove("on"); gsap.set(from.querySelector(".frame"), { x: 0, opacity: 1 }); });
      tl.fromTo(to, { clipPath: dir > 0 ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)" },
                    { clipPath: "inset(0 0% 0 0%)", duration: 0.7, ease: "expo.inOut" }, 0);
    }
    tl.fromTo(items(to), { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power3.out", stagger: 0.045 }, from ? 0.35 : 0.1);
    m.enter && m.enter(dir);
    if (m.step) m.step(step, true);
  }

  function next() {
    const m = modOf(cur);
    if (step < m.steps) { step++; m.step(step, false); return; }
    show(cur + 1, 1);
  }
  function prev() {
    const m = modOf(cur);
    if (step > 0) { step--; m.step(step, false, true); return; }
    show(cur - 1, -1);
  }

  addEventListener("keydown", e => {
    if (ov.classList.contains("open")) {
      if (e.key === "Escape" || e.key.toLowerCase() === "o") toggleOverview(false);
      return;
    }
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); next(); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); prev(); }
    else if (e.key === "Home") show(0, -1);
    else if (e.key === "End") show(slides.length - 1, 1);
    else if (e.key.toLowerCase() === "f") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    else if (e.key.toLowerCase() === "o" || e.key === "Escape") toggleOverview(true);
  });
  document.getElementById("bNext").onclick = next;
  document.getElementById("bPrev").onclick = prev;
  let tx = null;
  addEventListener("touchstart", e => { tx = e.touches[0].clientX; }, { passive: true });
  addEventListener("touchend", e => { if (tx === null) return; const d = e.changedTouches[0].clientX - tx; if (Math.abs(d) > 50) (d < 0 ? next : prev)(); tx = null; });

  // overview: a long scrollable sorter, smoothed with Lenis
  const ov = document.getElementById("overview"), grid = document.getElementById("ovGrid");
  slides.forEach((s, i) => {
    const c = document.createElement("div"); c.className = "ov-card";
    c.innerHTML = `<b>${pad(i + 1)}</b><span>${s.dataset.title}</span><small>${s.dataset.sub || ""}</small>`;
    c.onclick = () => { toggleOverview(false); show(i, i > cur ? 1 : -1); };
    grid.appendChild(c);
  });
  const lenis = new Lenis({ wrapper: ov, content: ov.firstElementChild, lerp: 0.1 });
  gsap.ticker.add(t => lenis.raf(t * 1000));
  lenis.stop();
  function toggleOverview(open) {
    ov.classList.toggle("open", open);
    [...grid.children].forEach((c, i) => c.classList.toggle("cur", i === cur));
    if (open) {
      lenis.start(); lenis.scrollTo(0, { immediate: true });
      gsap.fromTo(grid.children, { y: 20, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.03, duration: 0.45, ease: "power3.out" });
    } else lenis.stop();
  }

  function register(id, mod) { mods[id] = mod; }
  function start() {
    const h = parseInt(location.hash.slice(1), 10);
    show(h >= 1 && h <= slides.length ? h - 1 : 0, 1);
  }
  return { register, start, get current() { return cur; } };
})();

/* shared helpers */
const tip = document.getElementById("tip");
function svgEl(svg, tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  svg.appendChild(e); return e;
}
function hoverTip(target, html) {
  target.addEventListener("mousemove", e => { tip.innerHTML = html; tip.style.opacity = 1; tip.style.left = e.clientX + 14 + "px"; tip.style.top = e.clientY + 14 + "px"; });
  target.addEventListener("mouseleave", () => { tip.style.opacity = 0; });
}

addEventListener("DOMContentLoaded", () => {
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => Deck.start());
});
