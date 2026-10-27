// Argument provenance. Every piece of text the agent has seen is stored with two labels:
// integrity (who wrote it) and confidentiality (who may see it). When the agent calls a tool,
// each argument value is traced back to the segments it came from.

import type { ArgLabel, Confidentiality, Integrity } from "./types.js";
import { CONF_RANK } from "./types.js";
import { containment, normalizeValue, shingles, variants, type Variant } from "./normalize.js";

export interface Segment {
  id: number;
  source: string;
  integrity: Integrity;
  confidentiality: Confidentiality;
  raw: string;
  variants: Variant[];
  shingles: Set<string>;
  tokens: Set<string>;
}

/** Distinctive values worth tracing on their own: keys, addresses, URLs, account and repo ids. */
export function salientTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const v of text.match(/[a-z0-9][a-z0-9_\-.@:\/+]{7,}[a-z0-9]/g) ?? []) {
    if (/[0-9@_:\/]/.test(v) && !/^\d{1,4}([.:-]\d{1,2})*$/.test(v)) out.add(v.replace(/[.:]+$/, ""));
  }
  return out;
}

const MIN_LEN = 4;
const FUZZY_MIN_LEN = 40;
const FUZZY_THRESHOLD = 0.35;
const SEAM = 160;

export function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export class LabelStore {
  private segments: Segment[] = [];
  private seq = 0;

  constructor(private deep = true) {}

  setDeep(deep: boolean) {
    this.deep = deep;
    for (const s of this.segments) {
      s.variants = variants(s.raw, deep);
      s.tokens = new Set();
      for (const v of s.variants) for (const t of salientTokens(v.text)) s.tokens.add(t);
    }
  }

  add(source: string, text: string, integrity: Integrity, confidentiality: Confidentiality): Segment {
    const seg: Segment = {
      id: ++this.seq,
      source,
      integrity,
      confidentiality,
      raw: text,
      variants: variants(text, this.deep),
      shingles: shingles(text),
      tokens: new Set<string>(),
    };
    for (const v of seg.variants) for (const t of salientTokens(v.text)) seg.tokens.add(t);
    this.segments.push(seg);
    return seg;
  }

  get all(): readonly Segment[] {
    return this.segments;
  }

  get hasUntrusted(): boolean {
    return this.segments.some((s) => s.integrity === "UNTRUSTED");
  }

  /** Trace one argument value back to the segments it appears in. */
  label(arg: string, value: unknown): ArgLabel {
    const raw = stringify(value);
    const v = normalizeValue(raw, this.deep);
    const valueForms = this.deep ? variants(raw, true).map((x) => x.text.trim()) : [v];
    const result: ArgLabel = { arg, integrity: "TRUSTED", confidentiality: "PUBLIC", sources: [] };
    if (v.length < MIN_LEN) return result;

    const valueShingles = raw.length >= FUZZY_MIN_LEN ? shingles(raw) : null;
    const hits: { seg: Segment; via: string }[] = [];
    for (const seg of this.segments) {
      let via: string | null = null;
      for (const form of valueForms) {
        if (form.length < MIN_LEN) continue;
        const sv = seg.variants.find((x) => x.text.includes(form));
        if (sv) {
          via = form === v ? sv.via : `${sv.via} (value encoded)`;
          break;
        }
      }
      if (!via && valueShingles && containment(valueShingles, seg.shingles) >= FUZZY_THRESHOLD) {
        via = "fuzzy overlap";
      }
      if (!via && v.length > MIN_LEN) {
        // a distinctive token of the segment copied into the value, even if the value was then re-encoded
        outer: for (const form of valueForms) {
          for (const tok of seg.tokens) {
            if (tok.length < form.length && form.includes(tok)) {
              via = `contains copied value ${tok.length > 24 ? tok.slice(0, 24) + "..." : tok}${form === v ? "" : " (value encoded)"}`;
              break outer;
            }
          }
        }
      }
      if (via) hits.push({ seg, via });
    }
    // a value split across two consecutive untrusted results ("evil@" then "mail.io") appears in neither alone
    if (this.deep && !hits.some((h) => h.seg.integrity === "UNTRUSTED")) {
      const untrusted = this.segments.filter((x) => x.integrity === "UNTRUSTED");
      for (let i = 0; i + 1 < untrusted.length; i++) {
        const a = untrusted[i];
        const b = untrusted[i + 1];
        const seam = a.variants[0].text.slice(-SEAM) + b.variants[0].text.slice(0, SEAM);
        if (valueForms.some((f) => f.length >= MIN_LEN && seam.includes(f))) {
          hits.push({ seg: a, via: "spans two tool results" }, { seg: b, via: "spans two tool results" });
          break;
        }
      }
    }
    if (!hits.length) return result;

    // "plain" only counts as the user's own text when the characters really are there: a value that
    // matches only after Unicode folding (Cyrillic o, zero-width, fullwidth) is a lookalike, not a copy
    const literal = raw.trim().toLowerCase();
    const exact = (seg: Segment) => seg.raw.toLowerCase().includes(literal);
    const inTrusted = hits.some((h) => h.seg.integrity === "TRUSTED" && (h.via.startsWith("contains") || (h.via === "plain" && exact(h.seg))));
    const lookalike = !inTrusted && hits.some((h) => h.seg.integrity === "TRUSTED" && h.via === "plain");
    const untrusted = hits.filter((h) => h.seg.integrity === "UNTRUSTED");
    if (untrusted.length && !inTrusted) {
      result.integrity = "UNTRUSTED";
      result.via = untrusted[0].via;
    } else if (lookalike) {
      result.integrity = "UNTRUSTED";
      result.via = "lookalike of trusted text (homoglyph, zero-width or width variant)";
    }
    for (const h of hits) {
      if (CONF_RANK[h.seg.confidentiality] > CONF_RANK[result.confidentiality]) {
        result.confidentiality = h.seg.confidentiality;
      }
    }
    result.sources = [...new Set(hits.map((h) => h.seg.source))];
    if (!result.via && hits.some((h) => h.via !== "plain")) result.via = hits.find((h) => h.via !== "plain")!.via;
    return result;
  }

  /** Copy of the visible history with every untrusted segment masked, for shadow replay. */
  maskedSources(): Set<string> {
    return new Set(this.segments.filter((s) => s.integrity === "UNTRUSTED").map((s) => s.source));
  }
}
