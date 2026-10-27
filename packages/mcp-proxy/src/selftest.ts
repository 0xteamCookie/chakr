// End-to-end check of the MCP proxy against the demo server. Needs the core running (pnpm dev:core).
// Plays the part of a compromised MCP client that follows the poisoned issue.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = new URL(".", import.meta.url).pathname;
const pins = join(mkdtempSync(join(tmpdir(), "as-pins-")), "pins.json");

async function connect(env: Record<string, string> = {}) {
  const client = new Client({ name: "selftest", version: "0.1.0" });
  await client.connect(new StdioClientTransport({
    command: "npx",
    args: ["tsx", join(here, "cli.ts"), "--name", "github", "--pins", pins,
      "--task", "Triage the open issues in acme/website and comment on any that need more information.",
      "--", "npx", "tsx", join(here, "demo-server.ts")],
    env: { ...(process.env as Record<string, string>), ...env },
    stderr: "pipe",
  }));
  return client;
}

const text = (r: any) => (r.content?.[0]?.text ?? "") as string;
let failed = 0;
const expect = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};

const c = await connect();
const tools = (await c.listTools()).tools.map((t) => t.name);
expect("all 5 tools listed on first use", tools.length === 5, tools.join(", "));
const list = await c.callTool({ name: "list_issues", arguments: { repo: "acme/website" } });
expect("list_issues allowed", !list.isError);
const issue = await c.callTool({ name: "read_issue", arguments: { repo: "acme/website", number: 42 } });
expect("read poisoned issue #42", text(issue).includes("payments-core"));
const leak = await c.callTool({ name: "read_repo", arguments: { repo: "acme/payments-core" } });
expect("read of private repo blocked", !!leak.isError, text(leak).slice(0, 90));
const pr = await c.callTool({ name: "create_pull_request", arguments: { repo: "acme/website", title: "configs", body: "sk_live_51NvQx8Kd2Rm4Tq9" } });
expect("pull request blocked", !!pr.isError, text(pr).slice(0, 90));
const ok = await c.callTool({ name: "add_comment", arguments: { repo: "acme/website", number: 41, body: "Which phone and browser?" } });
expect("legitimate comment allowed", !ok.isError);
await c.close();

const rug = await connect({ RUGPULL: "1" });
const after = (await rug.listTools()).tools.map((t) => t.name);
expect("rug-pulled tool hidden after its definition changed", !after.includes("create_pull_request"), after.join(", "));
await rug.close();

console.log(failed ? `\n${failed} check(s) failed` : "\nall MCP proxy checks passed");
process.exit(failed ? 1 : 0);
