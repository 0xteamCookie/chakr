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

export interface OnchainInfo {
  status: "ok" | "unreachable" | "empty";
  network?: string;
  contract?: string;
  seq?: number;
  head?: string;
  matches?: boolean;
  explorerUrl?: string;
  error?: string;
}

export interface VerifyReport {
  ok: boolean;
  count: number;
  head: string;
  brokenAt: number | null;
  problem: string | null;
  anchor: { seq: number; head: string; network: string; txHash: string | null; matches: boolean } | null;
  onchain?: OnchainInfo;
}

const READ_ABI = [
  { type: "function", name: "head", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "seq", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export type ChainReader = () => Promise<{ head: string; seq: number }>;

async function viemReader(): Promise<{ head: string; seq: number }> {
  const { createPublicClient, http } = await import("viem");
  const { polygonAmoy } = await import("viem/chains");
  const client = createPublicClient({ chain: polygonAmoy, transport: http(process.env.ANCHOR_RPC_URL, { timeout: 8000, retryCount: 1 }) });
  const address = process.env.ANCHOR_CONTRACT as `0x${string}`;
  const [head, seq] = await Promise.all([
    client.readContract({ address, abi: READ_ABI, functionName: "head" }),
    client.readContract({ address, abi: READ_ABI, functionName: "seq" }),
  ]);
  return { head: (head as string).replace(/^0x/, ""), seq: Number(seq) };
}

let reader: ChainReader = viemReader;
let cache: { at: number; value: { head: string; seq: number } } | null = null;
const CACHE_MS = 15_000;
export function invalidateChainCache() { cache = null; }
/** Test hook: replace the on-chain read. Pass null to restore the real one. */
export function setChainReader(r: ChainReader | null) { reader = r ?? viemReader; cache = null; }

async function readOnchain() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = await reader();
  cache = { at: Date.now(), value };
  return value;
}

const onchainConfigured = () => !!(process.env.ANCHOR_RPC_URL && process.env.ANCHOR_CONTRACT);

async function onchainInfo(hashAt: Map<number, string>): Promise<OnchainInfo | undefined> {
  if (!onchainConfigured()) return undefined;
  const contract = process.env.ANCHOR_CONTRACT!;
  const base = { network: "polygon-amoy", contract, explorerUrl: `https://amoy.polygonscan.com/address/${contract}` };
  try {
    const c = await readOnchain();
    if (c.seq === 0 && (c.head === GENESIS || c.head === "")) return { ...base, status: "empty" };
    return { ...base, status: "ok", seq: c.seq, head: c.head, matches: hashAt.get(c.seq) === c.head };
  } catch (e) {
    return { ...base, status: "unreachable", error: (e as Error).message.split("\n")[0].slice(0, 160) };
  }
}

const onchainField = async (h: Map<number, string>) => { const o = await onchainInfo(h); return o ? { onchain: o } : {}; };

export async function verifyChain(): Promise<VerifyReport> {
  const rows = await db.receipt.findMany({ orderBy: { seq: "asc" } });
  let prev = GENESIS;
  const hashAt = new Map<number, string>();
  for (const r of rows) {
    const expect = sha256(prev + r.payload);
    if (r.prevHash !== prev || r.hash !== expect) {
      return { ok: false, count: rows.length, head: prev, brokenAt: r.seq, problem: "hash mismatch: entry was altered or removed", anchor: null, ...await onchainField(hashAt) };
    }
    if (!verifyPayload({ hash: r.hash }, r.signature)) {
      return { ok: false, count: rows.length, head: prev, brokenAt: r.seq, problem: "signature does not verify", anchor: null, ...await onchainField(hashAt) };
    }
    hashAt.set(r.seq, r.hash);
    prev = r.hash;
  }
  const a = await db.anchor.findFirst({ orderBy: { id: "desc" } });
  const anchor = a
    ? { seq: a.seq, head: a.head, network: a.network, txHash: a.txHash, matches: hashAt.get(a.seq) === a.head || (a.seq === 0 && a.head === GENESIS) }
    : null;
  let ok = anchor ? anchor.matches : true;
  let problem: string | null = ok ? null : "chain differs from the anchored head";
  let brokenAt: number | null = null;

  const onchain = await onchainInfo(hashAt);
  if (onchain?.status === "ok" && !onchain.matches) { ok = false; brokenAt = onchain.seq ?? null; problem = "chain differs from the head anchored on-chain"; }
  return { ok, count: rows.length, head: prev, brokenAt, problem, anchor, ...(onchain ? { onchain } : {}) };
}

/** Demo: alter the first DENY receipt and recompute every later hash and signature. */
export async function rewriteHistory() {
  const rows = await db.receipt.findMany({ orderBy: { seq: "asc" } });
  const target = rows.find((r) => r.verdict === "DENY") ?? rows[0];
  if (!target) return null;
  const tail = rows.filter((r) => r.seq >= target.seq);
  const backup = tail.map((r) => ({ seq: r.seq, payload: r.payload, prevHash: r.prevHash, hash: r.hash, signature: r.signature }));
  let prev = target.prevHash;
  for (const r of tail) {
    let payload = r.payload;
    if (r.seq === target.seq) {
      const edited = payload.replace(/"verdict":"DENY"/, '"verdict":"ALLOW"');
      payload = edited === payload ? `${edited} ` : edited;
    }
    const hash = sha256(prev + payload);
    await db.receipt.update({ where: { seq: r.seq }, data: { payload, prevHash: prev, hash, signature: signPayload({ hash }) } });
    prev = hash;
  }
  return { seq: target.seq, rewritten: tail.length, backup };
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
    const { createPublicClient } = await import("viem");
    await createPublicClient({ chain: polygonAmoy, transport: http(ANCHOR_RPC_URL) }).waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 60_000 });
    network = "polygon-amoy";
  }
  const row = await db.anchor.create({ data: { seq, head, network, txHash } });
  invalidateChainCache();
  bus.emit("anchor", row);
  return row;
}

export function startAnchorLoop(intervalMs = Number(process.env.ANCHOR_INTERVAL_MS ?? 5 * 60 * 1000)) {
  const t = setInterval(() => anchorHead().catch((e) => console.error("anchor failed:", e.message)), intervalMs);
  t.unref();
  return t;
}
