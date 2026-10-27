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
  "Three checks. Your request becomes a signed list of what the agent may do. Every value is traced to where it came from. Risky actions wait for a person.",
  "Every decision becomes a receipt, chained by hashes, with the head written to Polygon. Edit one and the chain breaks there. Rewrite all of it and the on-chain head gives it away.",
  "Real numbers, including the bad news. 1,054 attacks, none succeed, no normal calls blocked. 63 bypass attempts we wrote ourselves, and we publish the 15 that still get through.",
  "It drops in with five lines, or as a proxy for tools people already use. Then hand over to the live demo.",
];
