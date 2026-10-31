// Prompt Guard 2 (Meta, 86M): a local ML classifier for injected instructions, run with transformers.js.
// Advisory only, like every detector here: its score can raise risk, never allow or deny a call. Adaptive
// attacks bypass classifiers (Nasr, Carlini et al., USENIX Security 2026), and on our own realistic demo
// attacks it scores "benign", which is exactly why the decision rests on contracts and provenance.
//
// Model: the ONNX export of meta-llama/Llama-Prompt-Guard-2-86M (Llama 4 Community License), fetched once with
// `pnpm --filter @agentshield/core model:fetch` into .data/models. Without it the core uses the heuristic.
// DETECTOR=heuristic turns the model off.

import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DATA_DIR } from "./crypto.js";

export const PROMPT_GUARD_NAME = "Prompt Guard 2 (86M)";
export const promptGuardDir = () => process.env.PROMPT_GUARD_DIR ?? join(DATA_DIR, "models", "prompt-guard-2-86m");
export const promptGuardFile = () => join(promptGuardDir(), "onnx", "model_quantized.onnx");

type Classifier = (text: string, opts: { top_k: number }) => Promise<{ label: string; score: number }[]>;
let clf: Classifier | null = null;

export const promptGuardReady = () => clf !== null;

/** Loads the model if it is on disk. Returns false (heuristic only) when it is missing or turned off. */
export async function loadPromptGuard(): Promise<boolean> {
  if (process.env.DETECTOR === "heuristic" || !existsSync(promptGuardFile())) return false;
  const { pipeline, env } = await import("@huggingface/transformers");
  env.localModelPath = `${dirname(promptGuardDir())}/`;
  env.allowRemoteModels = false;
  clf = (await pipeline("text-classification", basename(promptGuardDir()), { dtype: "q8" })) as unknown as Classifier;
  return true;
}

/** Probability that the text contains injected instructions. Long text is scored in overlapping windows (the model reads 512 tokens). */
export async function promptGuardScore(text: string): Promise<number> {
  if (!clf) throw new Error("Prompt Guard is not loaded");
  const windows: string[] = [];
  for (let i = 0; i < Math.max(1, text.length) && windows.length < 8; i += 1500) windows.push(text.slice(Math.max(0, i - 200), i + 1500));
  let worst = 0;
  for (const w of windows) {
    const out = await clf(w, { top_k: 2 });
    worst = Math.max(worst, out.find((o) => o.label === "MALICIOUS")?.score ?? 0);
  }
  return Number(worst.toFixed(4));
}
