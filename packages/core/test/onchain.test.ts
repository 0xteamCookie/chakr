import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "agentshield-onchain-"));
process.env.AGENTSHIELD_DATA_DIR = dir;
process.env.DATABASE_URL = `file:${join(dir, "test.db")}`;
delete process.env.ANCHOR_PRIVATE_KEY;

let r: typeof import("../src/receipts.js");
const payload = (verdict: string, i: number) => ({
  sessionId: "s", agentId: "a", tool: `t${i}`, args: {}, verdict, risk: "LOW", reasons: [], labels: [], at: new Date().toISOString(),
});

beforeAll(async () => {
  execSync("npx prisma db push --skip-generate", { env: process.env, stdio: "ignore" });
  r = await import("../src/receipts.js");
  await r.appendReceipt(payload("ALLOW", 1));
  await r.appendReceipt(payload("DENY", 2));
  await r.appendReceipt(payload("ALLOW", 3));
}, 60_000);

describe("on-chain verification (mocked chain)", () => {
  it("matches the anchored head, then catches a rewritten history the DB-only check misses", async () => {
    const before = await r.verifyChain();
    expect(before.onchain).toBeUndefined();
    process.env.ANCHOR_RPC_URL = "http://mock";
    process.env.ANCHOR_CONTRACT = "0x0000000000000000000000000000000000000001";
    r.setChainReader(async () => ({ head: before.head, seq: before.count }));
    const ok = await r.verifyChain();
    expect(ok.ok).toBe(true);
    expect(ok.onchain).toMatchObject({ status: "ok", matches: true, seq: 3, localSeq: 3 });

    // what "Anchor now" records after a successful on-chain write
    const { db } = await import("../src/db.js");
    await db.anchor.create({ data: { seq: before.count, head: before.head, network: "polygon-amoy", txHash: "0xmock" } });

    const rw = await r.rewriteHistory();
    expect(rw?.rewritten).toBe(2);
    r.setChainReader(async () => ({ head: before.head, seq: before.count }));
    const bad = await r.verifyChain();
    expect(bad.ok).toBe(false);
    expect(bad.brokenAt).toBe(3);
    expect(bad.problem).toBe("chain differs from the head anchored on-chain");
    expect(bad.onchain?.matches).toBe(false);
  });

  it("a fresh or reset database is not reported as tampered by a head another database anchored", async () => {
    const { db } = await import("../src/db.js");
    const saved = await db.anchor.findMany();
    await db.anchor.deleteMany();
    r.setChainReader(async () => ({ head: "f".repeat(64), seq: 3345 }));
    const v = await r.verifyChain();
    expect(v.onchain?.status).toBe("foreign");
    expect(v.problem).not.toBe("chain differs from the head anchored on-chain");
    for (const a of saved) await db.anchor.create({ data: { seq: a.seq, head: a.head, network: a.network, txHash: a.txHash } });
  });

  it("anchors with a seq the contract accepts after a database reset", () => {
    expect(r.chainSeqFor(12, 3345)).toBe(3346);
    expect(r.chainSeqFor(4000, 3345)).toBe(4000);
    expect(r.chainSeqFor(1, 0)).toBe(1);
  });

  it("falls back when the RPC is unreachable", async () => {
    r.setChainReader(async () => { throw new Error("connect ECONNREFUSED"); });
    const v = await r.verifyChain();
    expect(v.onchain?.status).toBe("unreachable");
    expect(v.brokenAt).toBeNull();
  });
});
