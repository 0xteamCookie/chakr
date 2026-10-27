// Verifiable audit: every decision becomes an Ed25519-signed receipt whose hash includes
// the previous receipt's hash. The chain head is anchored periodically, on a public
// testnet when configured (ANCHOR_RPC_URL, ANCHOR_PRIVATE_KEY, ANCHOR_CONTRACT), else locally.

import { db } from "./db.js";
import { canonicalJson, sha256, signPayload, verifyPayload } from "./crypto.js";
import { bus } from "./events.js";

export const GENESIS = "0".repeat(64);

export interface ReceiptPayload {
  sessionId: string;
  agentId: string;
  tool: string;
  args: Record<string, unknown>;
  verdict: string;
  risk: string;
  reasons: string[];
  labels: unknown[];
  reviewer?: string | null;
  at: string;
}

let queue: Promise<unknown> = Promise.resolve();

/** Appends serially so the chain can never fork. */
export function appendReceipt(p: ReceiptPayload) {
  const job = queue.then(async () => {
    const last = await db.receipt.findFirst({ orderBy: { seq: "desc" } });
    const prevHash = last?.hash ?? GENESIS;
    const payload = canonicalJson(p);
    const hash = sha256(prevHash + payload);
    const signature = signPayload({ hash });
    const row = await db.receipt.create({
      data: { sessionId: p.sessionId, tool: p.tool, verdict: p.verdict, payload, prevHash, hash, signature },
    });
    bus.emit("receipt", { seq: row.seq, tool: row.tool, verdict: row.verdict, hash: row.hash });
    return row;
  });
  queue = job.catch(() => undefined);
  return job;
}

export interface VerifyReport {
  ok: boolean;
  count: number;
  head: string;
  brokenAt: number | null;
  problem: string | null;
  anchor: { seq: number; head: string; network: string; txHash: string | null; matches: boolean } | null;
}

export async function verifyChain(): Promise<VerifyReport> {
  const rows = await db.receipt.findMany({ orderBy: { seq: "asc" } });
  let prev = GENESIS;
  const hashAt = new Map<number, string>();
  for (const r of rows) {
    const expect = sha256(prev + r.payload);
    if (r.prevHash !== prev || r.hash !== expect) {
      return { ok: false, count: rows.length, head: prev, brokenAt: r.seq, problem: "hash mismatch: entry was altered or removed", anchor: null };
    }
    if (!verifyPayload({ hash: r.hash }, r.signature)) {
      return { ok: false, count: rows.length, head: prev, brokenAt: r.seq, problem: "signature does not verify", anchor: null };
    }
    hashAt.set(r.seq, r.hash);
    prev = r.hash;
  }
  const a = await db.anchor.findFirst({ orderBy: { id: "desc" } });
  const anchor = a
    ? { seq: a.seq, head: a.head, network: a.network, txHash: a.txHash, matches: hashAt.get(a.seq) === a.head || (a.seq === 0 && a.head === GENESIS) }
    : null;
  const ok = anchor ? anchor.matches : true;
  return { ok, count: rows.length, head: prev, brokenAt: null, problem: ok ? null : "chain differs from the anchored head", anchor };
}

const ANCHOR_ABI = [
  {
    type: "function",
    name: "anchor",
    stateMutability: "nonpayable",
    inputs: [{ name: "head", type: "bytes32" }, { name: "seq", type: "uint256" }],
    outputs: [],
  },
] as const;

/** Commits the current chain head. Uses a real chain when configured, else records locally. */
export async function anchorHead() {
  const last = await db.receipt.findFirst({ orderBy: { seq: "desc" } });
  const seq = last?.seq ?? 0;
  const head = last?.hash ?? GENESIS;
  const prevAnchor = await db.anchor.findFirst({ orderBy: { id: "desc" } });
  if (prevAnchor && prevAnchor.seq === seq) return prevAnchor;

  let network = "local";
  let txHash: string | null = null;
  const { ANCHOR_RPC_URL, ANCHOR_PRIVATE_KEY, ANCHOR_CONTRACT } = process.env;
  if (ANCHOR_RPC_URL && ANCHOR_PRIVATE_KEY && ANCHOR_CONTRACT) {
    const { createWalletClient, http } = await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");
    const { polygonAmoy } = await import("viem/chains");
    const client = createWalletClient({
      account: privateKeyToAccount(ANCHOR_PRIVATE_KEY as `0x${string}`),
      chain: polygonAmoy,
      transport: http(ANCHOR_RPC_URL),
    });
    txHash = await client.writeContract({
      address: ANCHOR_CONTRACT as `0x${string}`,
      abi: ANCHOR_ABI,
      functionName: "anchor",
      args: [`0x${head}`, BigInt(seq)],
    });
    network = "polygon-amoy";
  }
  const row = await db.anchor.create({ data: { seq, head, network, txHash } });
  bus.emit("anchor", row);
  return row;
}

export function startAnchorLoop(intervalMs = Number(process.env.ANCHOR_INTERVAL_MS ?? 5 * 60 * 1000)) {
  const t = setInterval(() => anchorHead().catch((e) => console.error("anchor failed:", e.message)), intervalMs);
  t.unref();
  return t;
}
