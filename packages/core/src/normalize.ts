// De-obfuscation: turn the many ways an attacker can hide a value into one canonical form.
// Used on both sides of a provenance match: the untrusted corpus and the argument value.

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;

// Common Cyrillic / Greek look-alikes of Latin letters
const HOMOGLYPHS: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x",
  "у": "y", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "һ": "h",
  "к": "k", "м": "m", "т": "t", "в": "b", "н": "h",
  "α": "a", "ο": "o", "ρ": "p", "ε": "e", "ι": "i", "κ": "k",
  "ν": "v", "τ": "t", "υ": "u", "χ": "x",
};

/** Unicode and case normalisation shared by values and corpora. */
export function canonical(s: string): string {
  let t = s.normalize("NFKC").replace(ZERO_WIDTH, "").toLowerCase();
  t = t.replace(/[Ͱ-ϿЀ-ԯ]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
  return t;
}

function spelledOut(t: string): string {
  return t
    .replace(/\s*[\[\(\{<]\s*dot\s*[\]\)\}>]\s*/g, ".")
    .replace(/\s*[\[\(\{<]\s*at\s*[\]\)\}>]\s*/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+at\s+/g, "@");
}

function collapseSpaced(t: string): string {
  // "a m y . w a t s o n" -> "amy.watson"; a wider gap between letters marks a real word break
  return t.replace(/(?:\S {1,3}){3,}\S/g, (m) => {
    if (!/^(?:\S(?: | {3}))+\S$/.test(m)) return m;
    return m.split("   ").map((w) => w.replace(/ /g, "")).join(" ");
  });
}

function percentDecode(t: string): string | null {
  if (!/%[0-9a-f]{2}/i.test(t)) return null;
  try {
    return decodeURIComponent(t.replace(/%(?![0-9a-f]{2})/gi, "%25"));
  } catch {
    return null;
  }
}

function decodeTokens(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.match(/[A-Za-z0-9+/]{8,}={0,2}/g) ?? []) {
    const d = Buffer.from(m, "base64").toString("utf8");
    if (/^[\x20-\x7e]{6,}$/.test(d)) out.push(d);
  }
  for (const m of raw.match(/\b(?:[0-9a-fA-F]{2}){5,}\b/g) ?? []) {
    const d = Buffer.from(m, "hex").toString("utf8");
    if (/^[\x20-\x7e]{5,}$/.test(d)) out.push(d);
  }
  return out;
}

export interface Variant {
  text: string;
  via: string;
}

/**
 * All decoded readings of a piece of untrusted text. The first entry is the
 * plain canonical form; the rest are de-obfuscated alternatives.
 */
export function variants(raw: string, deep = true): Variant[] {
  const base = deep ? canonical(raw) : raw.toLowerCase();
  const out: Variant[] = [{ text: base, via: "plain" }];
  if (!deep) return out;
  const push = (text: string | null, via: string) => {
    if (text && text !== base && !out.some((v) => v.text === text)) out.push({ text, via });
  };
  push(spelledOut(base), "spelled-out");
  push(collapseSpaced(base), "spaced letters");
  push(percentDecode(base), "url-encoding");
  for (const d of decodeTokens(raw)) {
    const c = canonical(d);
    push(c, /^[0-9a-f]+$/i.test(raw.trim()) ? "hex" : "base64/hex");
    push(spelledOut(c), "base64/hex + spelled-out");
  }
  // second pass for stacked tricks, e.g. spelled-out text that is also spaced
  for (const v of [...out]) {
    push(spelledOut(collapseSpaced(v.text)), v.via === "plain" ? "spaced + spelled-out" : v.via);
  }
  return out;
}

export function normalizeValue(v: string, deep = true): string {
  const c = deep ? canonical(v) : v.toLowerCase();
  return c.trim();
}

/** Word shingles for fuzzy overlap of longer text. */
export function shingles(t: string, n = 4): Set<string> {
  const words = canonical(t).split(/[^a-z0-9@._-]+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  if (words.length < n && words.length) out.add(words.join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Share of a's shingles that also appear in b. */
export function containment(a: Set<string>, b: Set<string>): number {
  if (!a.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / a.size;
}
