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
    .replace(/\s+(?:dot|punto|point|punkt)\s+/g, ".")
    .replace(/\s+(?:at|arroba|arobase)\s+/g, "@");
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

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", commat: "@", period: ".", lowbar: "_", hyphen: "-", dash: "-", colon: ":", sol: "/",
};

/** &#64; &#x40; &commat; -> the character they stand for. */
function htmlDecode(t: string): string | null {
  if (!t.includes("&")) return null;
  return t.replace(/&(?:#(\d{1,6})|#x([0-9a-f]{1,6})|([a-z]{2,8}));?/gi, (m, dec, hex, name) => {
    const cp = dec ? Number(dec) : hex ? parseInt(hex, 16) : null;
    if (cp !== null) return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    return NAMED_ENTITIES[String(name).toLowerCase()] ?? m;
  });
}

/** Markdown backslash escapes: ceo\-backup -> ceo-backup. */
function markdownUnescape(t: string): string | null {
  return t.includes("\\") ? t.replace(/\\([!-/:-@[-`{-~])/g, "$1") : null;
}

/** Unicode (backslash-u) and hex (backslash-x) escapes. */
function codeEscapes(t: string): string | null {
  if (!/\\(?:u[0-9a-f]{4}|x[0-9a-f]{2})/i.test(t)) return null;
  return t.replace(/\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_m, u, x) => String.fromCharCode(parseInt(u ?? x, 16)));
}

/** 'ceo-' + 'backup@' -> ceo-backup@ (also adjacent literals). */
function joinLiterals(t: string): string | null {
  const j = t.replace(/["'`]\s*\+?\s*["'`]/g, "");
  return j === t ? null : j.replace(/["'`]/g, "");
}

const rot13 = (t: string) => t.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const reversed = (t: string) => [...t].reverse().join("");

/** Runs of byte values written as decimal numbers (99 101 111) or spaced hex pairs (63 65 6f). */
function byteRuns(t: string): string | null {
  const out: string[] = [];
  for (const m of t.matchAll(/(?:\b\d{2,3}\b[ ,;:]+){4,}\b\d{2,3}\b/g)) {
    const codes = m[0].split(/[ ,;:]+/).map(Number);
    if (codes.every((c) => c >= 32 && c <= 126)) out.push(String.fromCharCode(...codes));
  }
  for (const m of t.matchAll(/(?:\b(?:0x)?[0-9a-f]{2}\b[ ,;:]+){4,}\b(?:0x)?[0-9a-f]{2}\b/gi)) {
    const codes = m[0].split(/[ ,;:]+/).map((h) => parseInt(h.replace(/^0x/i, ""), 16));
    if (codes.every((c) => c >= 32 && c <= 126)) out.push(String.fromCharCode(...codes));
  }
  return out.length ? out.join(" ") : null;
}

function base32Decode(s: string): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes).toString("utf8");
}

const PRINTABLE = /^[\x20-\x7e]{6,}$/;

function decodeTokens(raw: string, depth = 0): string[] {
  const out: string[] = [];
  // base64 wrapped across lines is read both as-is and re-joined
  const joined = /^[A-Za-z0-9+/=_\s-]+$/.test(raw.trim()) ? raw.replace(/\s+/g, "") : null;
  for (const text of joined && joined !== raw ? [raw, joined] : [raw]) {
    for (const m of text.match(/[A-Za-z0-9+/_-]{8,}={0,2}/g) ?? []) {
      const d = Buffer.from(m.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      if (PRINTABLE.test(d)) out.push(d);
    }
    for (const m of text.match(/\b[A-Z2-7]{8,}={0,6}/g) ?? []) {
      const d = base32Decode(m);
      if (PRINTABLE.test(d)) out.push(d);
    }
  }
  // base64 line-wrapped inside other text (MIME style)
  for (const m of raw.match(/(?:[A-Za-z0-9+/]{4,}[ \t]*\r?\n)+[A-Za-z0-9+/]{2,}={0,2}/g) ?? []) {
    const d = Buffer.from(m.replace(/\s+/g, ""), "base64").toString("utf8");
    if (PRINTABLE.test(d)) out.push(d);
  }
  for (const m of raw.match(/\b(?:[0-9a-fA-F]{2}){5,}\b/g) ?? []) {
    const d = Buffer.from(m, "hex").toString("utf8");
    if (/^[\x20-\x7e]{5,}$/.test(d)) out.push(d);
  }
  // stacked encodings, e.g. base64 of base64
  if (depth < 1) for (const d of [...out]) out.push(...decodeTokens(d, depth + 1));
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
  push(htmlDecode(base), "html entities");
  push(markdownUnescape(base), "markdown escapes");
  push(codeEscapes(base), "code escapes");
  push(joinLiterals(base), "joined string literals");
  push(byteRuns(base), "byte values");
  if (base.length >= 8) {
    push(rot13(base), "rot13");
    push(reversed(base), "reversed");
  }
  for (const d of decodeTokens(raw)) {
    const c = canonical(d);
    push(c, /^[0-9a-f]+$/i.test(raw.trim()) ? "hex" : "base64/hex");
    push(spelledOut(c), "base64/hex + spelled-out");
  }
  // second pass for stacked tricks, e.g. spelled-out text that is also spaced
  for (const v of [...out]) {
    push(spelledOut(collapseSpaced(v.text)), v.via === "plain" ? "spaced + spelled-out" : v.via);
    if (v.via !== "plain") push(htmlDecode(v.text), `${v.via} + html entities`);
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

/**
 * Attacker-influenced text (tool names, ids, argument values) that ends up in an approval card or an audit
 * line: control characters, bidi overrides and zero-width characters removed, one line, length capped.
 */
export function display(v: unknown, max = 80): string {
  const t = String(v ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}
