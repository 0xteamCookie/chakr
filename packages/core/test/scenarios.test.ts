import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "agentshield-test-"));
process.env.AGENTSHIELD_DATA_DIR = dir;
process.env.DATABASE_URL = `file:${join(dir, "test.db")}`;

let mod: typeof import("../src/index.js");
// reviewer that follows the shield's recommendation: deny when any argument is untrusted
const review = (d: { labels: { integrity: string }[] }) => !d.labels.some((l) => l.integrity === "UNTRUSTED");

beforeAll(async () => {
  execSync("npx prisma db push --skip-generate", { env: process.env, stdio: "ignore" });
  mod = await import("../src/index.js");
}, 60_000);

async function run(id: string, preset: keyof typeof import("../src/types.js").PRESETS, overrides = {}) {
  const { Shield, SCENARIOS, PRESETS, runScenario, allScenarioTools } = mod;
  const shield = new Shield(allScenarioTools());
  const sc = SCENARIOS.find((s) => s.id === id)!;
  return runScenario(shield, sc, preset === "off" ? "unprotected" : "protected",
    { ...PRESETS[preset], ...overrides }, preset, undefined, review);
}

describe("every attack succeeds without the shield", () => {
  for (const id of ["github-issue-leak", "support-ticket-leak", "invoice-fraud", "encoded-exfil", "paraphrased-broadcast"]) {
    it(id, async () => {
      const r = await run(id, "off");
      expect(r.harm).not.toBeNull();
    });
  }
});

describe("balanced preset stops every attack and keeps the task working", () => {
  for (const id of ["github-issue-leak", "support-ticket-leak", "encoded-exfil", "paraphrased-broadcast"]) {
    it(id, async () => {
      const r = await run(id, "balanced");
      expect(r.harm).toBeNull();
      expect(r.completed).toBe(true);
    });
  }
  it("invoice-fraud: attacker payment is escalated and denied", async () => {
    const r = await run("invoice-fraud", "balanced");
    expect(r.harm).toBeNull();
    const pay = r.steps.find((s) => s.call.tool === "payments.pay")!;
    expect(pay.decision!.reasons.join(" ")).toMatch(/email\.read/);
  });
  it("benign task: nothing is denied", async () => {
    const r = await run("benign-triage", "balanced");
    expect(r.completed).toBe(true);
    expect(r.steps.every((s) => s.decision?.verdict === "ALLOW")).toBe(true);
  });
});

describe("defence in depth: without the contract, other layers still hold", () => {
  it("github leak blocked by provenance (private data into public PR)", async () => {
    const r = await run("github-issue-leak", "permissive");
    expect(r.harm).toBeNull();
    const pr = r.steps.find((s) => s.call.tool === "github.create_pr");
    expect(pr?.decision?.layers.find((l) => l.layer === "provenance")?.outcome).toBe("block");
  });
  it("support leak blocked by provenance (secret into public reply)", async () => {
    const r = await run("support-ticket-leak", "permissive");
    expect(r.harm).toBeNull();
    expect(r.completed).toBe(true);
  });
  it("encoded exfil blocked by decoding base64", async () => {
    const r = await run("encoded-exfil", "permissive", { causal: false });
    expect(r.harm).toBeNull();
    const send = r.steps.find((s) => s.call.args.to === "amy.watson@gmail.com")!;
    expect(send.decision!.labels.find((l) => l.arg === "to")!.via).toMatch(/base64/);
  });
  it("without de-obfuscation the address is not traced, but the private-data rule still blocks", async () => {
    const r = await run("encoded-exfil", "permissive", { deobfuscate: false, causal: false });
    expect(r.harm).toBeNull();
    const send = r.steps.find((s) => s.call.args.to === "amy.watson@gmail.com")!;
    expect(send.decision!.labels.find((l) => l.arg === "to")!.integrity).toBe("TRUSTED");
    expect(send.decision!.reasons.join(" ")).toMatch(/PRIVATE data .* PUBLIC sink/);
  });
  it("encoded exfil leaks with provenance and the causal check off", async () => {
    const r = await run("encoded-exfil", "permissive", { provenance: false, causal: false });
    expect(r.harm).not.toBeNull();
  });
  it("paraphrased broadcast is caught only by the causal check", async () => {
    const on = await run("paraphrased-broadcast", "balanced");
    const off = await run("paraphrased-broadcast", "balanced", { causal: false });
    expect(on.harm).toBeNull();
    expect(off.harm).not.toBeNull();
    const blocked = on.steps.find((s) => String(s.call.args.text).includes("SSO"))!;
    expect(blocked.decision!.causal!.injectionDriven).toBe(true);
  });
});

describe("audit chain", () => {
  it("verifies, then detects tampering", async () => {
    const { verifyChain, anchorHead, db } = mod;
    await run("github-issue-leak", "balanced");
    await anchorHead();
    expect((await verifyChain()).ok).toBe(true);
    const row = await db.receipt.findFirst({ orderBy: { seq: "asc" } });
    await db.receipt.update({ where: { seq: row!.seq }, data: { payload: row!.payload.replace("ALLOW", "DENY") } });
    const report = await verifyChain();
    expect(report.ok).toBe(false);
    expect(report.brokenAt).toBe(row!.seq);
  });
});
