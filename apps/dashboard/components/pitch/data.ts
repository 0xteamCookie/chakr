import { API } from "@/lib/api";

/** Measured numbers (from the committed eval run). Used as-is when the core is offline. */
export const MEASURED = {
  injecagent: { attacks: 1054, detectorFlagged: 0 },
  layers: [
    { label: "No defence", asr: 100 },
    { label: "Provenance only", asr: 9.7 },
    { label: "Contract only", asr: 0 },
    { label: "Full AgentShield", asr: 0 },
  ],
  stress: { contractProvenance: 9.7, full: 0, escalated: 425 },
  falseBlocks: 0,
  p50ms: 0.09,
  adaptive: { variants: 63, unexplained: 0, known: 15 },
};

export type Live = {
  attacks?: number; detectorRate?: number; p50?: number; falseBlocks?: number; layers?: { label: string; asr: number }[];
  adaptive?: { variants?: number; unexplained?: number; known?: number };
};

/** Best-effort fetch of fresh numbers. Every field is optional, so a missing core or a changed shape just means "use the constants". */
export async function fetchLive(): Promise<Live | null> {
  const get = async (p: string) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    try {
      const r = await fetch(`${API}${p}`, { signal: ctl.signal, cache: "no-store" });
      return r.ok ? await r.json() : null;
    } catch { return null; } finally { clearTimeout(t); }
  };
  const [ev, ad] = await Promise.all([get("/api/eval"), get("/api/eval/adaptive")]);
  const out: Live = {};
  if (ev && Array.isArray(ev.configs) && ev.configs.length) {
    out.attacks = ev.cases?.total;
    out.p50 = ev.latency?.p50;
    out.detectorRate = ev.detector?.rate;
    const cfg = ev.configs as { key: string; label: string; asr: number; benignBlocked?: number }[];
    out.falseBlocks = cfg[cfg.length - 1]?.benignBlocked;
  }
  if (ad && Array.isArray(ad.variants)) {
    out.adaptive = { variants: ad.variants.length, unexplained: ad.bypasses?.length, known: ad.known?.length };
  }
  return out.attacks || out.adaptive ? out : null;
}

export const NOTES: string[] = [
  "Say who we are and the one-line idea. The model can think anything. It can only act inside what the user asked for.",
  "Walk the story. An assistant with email, payments and a shell reads a stranger's email. The email says pay 48,000. The model cannot tell data from commands, so it obeys.",
  "Flip the switch. With the shield off the money leaves. With it on, the call is stopped and the reason is shown in plain words.",
  "Three families of fix exist today, and each leaves a gap. Our own test: a text detector caught 0 of 1,054 real injections, so we never rely on one.",
  "Pick a request. We turn it into a short, signed list of what the agent may do. Click a tool the task never needed and see it denied.",
  "Every value in a tool call has a source. We trace it back, even through base64, hex and lookalike letters. Secrets cannot be sent to public places.",
  "One more check: replay the agent without the task. If it still makes the call, the task did not cause it. Risky calls go to a human with the reason and the source.",
  "Every decision becomes a receipt, chained by hashes. Edit one and the chain breaks there. Rewrite all of it and the on-chain head still gives it away.",
  "Real numbers, including the bad news. 1,054 attacks, none succeed, none of the normal calls blocked. 63 hand-written bypass attempts, and we publish the 15 limits.",
  "It drops in with five lines, or as a proxy for the tools people already use. Say what it is not: it does not make the model smarter, it limits what a fooled model can do.",
];
