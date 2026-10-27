// Advisory injection detector. It only ever raises risk; it never allows or denies on its own,
// because adaptive attacks bypass classifiers (Nasr, Carlini et al., 2025).
//
// Default: a transparent heuristic scorer. A Prompt Guard model can be plugged in through
// setDetector() without changing the engine.

import { canonical } from "./normalize.js";

export type DetectorFn = (text: string) => Promise<number> | number;

const SIGNALS: [RegExp, number][] = [
  [/\bignore (all |any )?(previous|prior|above) (instructions|messages)/, 0.6],
  [/\b(disregard|forget) (the|your|all) (previous|prior|above)/, 0.5],
  [/\b(system|assistant)\s*:/, 0.25],
  [/\byou (must|should|need to) (now )?(also )?(send|forward|post|transfer|pay|delete|read|open|create|run)/, 0.35],
  [/\b(also|additionally|first|before (you|replying)),? (please )?(send|forward|post|transfer|pay|delete|read|open|create|run|include)\b/, 0.3],
  [/\b(do not|don't) (tell|mention|inform|notify) (the )?user\b/, 0.45],
  [/\bto (properly|correctly|fully) (triage|answer|handle|process) (this|it)\b/, 0.2],
  [/\b(important|urgent)\b.{0,40}\b(instruction|action required)\b/, 0.2],
  [/\b(base64|decode|hex)\b/, 0.15],
  [/\b(api[_ ]?key|token|password|secret|credential)s?\b.{0,60}\b(send|post|include|reply|share)\b/, 0.3],
];

export function heuristicScore(text: string): number {
  const t = canonical(text);
  let score = 0;
  for (const [re, w] of SIGNALS) if (re.test(t)) score += w;
  return Math.min(1, Number(score.toFixed(2)));
}

let detector: DetectorFn = heuristicScore;
let detectorName = "heuristic";

export function setDetector(fn: DetectorFn, name: string) {
  detector = fn;
  detectorName = name;
}

export function currentDetector() {
  return detectorName;
}

export async function injectionScore(text: string): Promise<number> {
  return detector(text);
}
