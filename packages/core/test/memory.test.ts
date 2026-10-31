import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.AGENTSHIELD_DATA_DIR = mkdtempSync(join(tmpdir(), "agentshield-memory-"));

const { Shield } = await import("../src/engine.js");
const { actionKey, deniedBefore, rememberDenial, setDenialMemory, forgetDenials } = await import("../src/approvals.js");
const { PRESETS } = await import("../src/types.js");
type Spec = import("../src/types.js").ToolSpec;

const pay: Spec = { name: "make_payment", app: "bank", description: "pay", effect: "write", tier: "HIGH",
  keywords: ["pay"], controlArgs: ["to_account"], params: { to_account: "account", amount: "amount" } };
const payees: Spec = { name: "list_payees", app: "bank", description: "saved payees", effect: "read", tier: "LOW", keywords: [],
  outputIntegrity: "TRUSTED", params: {} };
const read: Spec = { name: "read_email", app: "mail", description: "read", effect: "read", tier: "LOW", keywords: [], params: { id: "id" } };

describe("untraced values (likely hallucinations)", () => {
  const run = async (flagUntraced: boolean, account: string) => {
    const shield = new Shield([pay, payees, read]);
    const s = shield.startSession({ task: "Pay Acme Office Rentals the rent of 85,000", settings: { ...PRESETS.balanced, flagUntraced } });
    await shield.recordResult(s.id, { id: "payees", tool: "list_payees", args: {} }, [{ name: "Acme Office Rentals", account: "2210 5531" }]);
    await shield.recordResult(s.id, { id: "e1", tool: "read_email", args: { id: 1 } }, "Rent of 85,000 is due. Pay to the account on file.");
    return shield.check(s.id, { id: "c1", tool: "make_payment", args: { to_account: account, amount: 85000 } }, { escalation: "return", record: false });
  };
  it("escalates a payment to an account that appears nowhere", async () => {
    const d = await run(true, "2210 5513");
    expect(d.verdict).toBe("ESCALATE");
    expect(d.reasons.join(" ")).toMatch(/appears nowhere/);
  });
  it("allows the account the user's own records hold", async () => {
    expect((await run(true, "2210 5531")).verdict).toBe("ALLOW");
  });
  it("is off unless the setting asks for it", async () => {
    expect((await run(false, "2210 5513")).reasons.join(" ")).not.toMatch(/appears nowhere/);
  });
});

describe("denial memory", () => {
  it("treats differently formatted copies of an action as the same action", () => {
    const a = actionKey({ id: "1", tool: "make_payment", args: { to_account: "9988 7720", amount: 48000 } }, pay);
    const b = actionKey({ id: "2", tool: "make_payment", args: { to_account: "99887720", amount: 1 } }, pay);
    expect(a).toBe(b);
  });
  it("remembers denials, can be switched off and forgotten", () => {
    const call = { id: "1", tool: "make_payment", args: { to_account: "9988 7720" } };
    const key = actionKey(call, pay);
    setDenialMemory(true);
    rememberDenial(key, call);
    expect(deniedBefore(key)).toBeTruthy();
    setDenialMemory(false);
    expect(deniedBefore(key)).toBeUndefined();
    setDenialMemory(true);
    expect(deniedBefore(key)).toBeTruthy();
    forgetDenials();
    expect(deniedBefore(key)).toBeUndefined();
  });
});
