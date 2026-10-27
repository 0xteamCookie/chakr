import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DATA_DIR = process.env.AGENTSHIELD_DATA_DIR ?? join(process.cwd(), ".data");

/** Deterministic JSON: object keys sorted at every level (RFC 8785 style for our data). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

interface KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicPem: string;
}

let cached: KeyPair | null = null;

/** Ed25519 signing key for contracts and receipts, created on first use. */
export function signingKey(): KeyPair {
  if (cached) return cached;
  const file = join(DATA_DIR, "keys", "ed25519.json");
  if (existsSync(file)) {
    const { priv, pub } = JSON.parse(readFileSync(file, "utf8"));
    cached = { privateKey: createPrivateKey(priv), publicKey: createPublicKey(pub), publicPem: pub };
    return cached;
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ priv, pub }), { mode: 0o600 });
  cached = { privateKey, publicKey, publicPem: pub };
  return cached;
}

export function signPayload(payload: unknown): string {
  return "ed25519:" + sign(null, Buffer.from(canonicalJson(payload)), signingKey().privateKey).toString("base64");
}

export function verifyPayload(payload: unknown, signature: string): boolean {
  if (!signature.startsWith("ed25519:")) return false;
  try {
    return verify(null, Buffer.from(canonicalJson(payload)), signingKey().publicKey,
      Buffer.from(signature.slice(8), "base64"));
  } catch {
    return false;
  }
}
