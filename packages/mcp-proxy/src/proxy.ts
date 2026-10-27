// AgentShield MCP proxy.
// To the MCP client (Claude Desktop, Cursor, VS Code) it is an ordinary MCP server.
// To the real server it is an ordinary MCP client. In between, every tools/call goes through
// the AgentShield core, and every tools/list is checked against pinned tool-definition hashes.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";

export interface ProxyOptions {
  serverName: string;
  command: string;
  args: string[];
  task: string;
  agentId?: string;
  core: string;
  pinsFile?: string;
  preset?: "strict" | "balanced" | "permissive";
  log?: (msg: string) => void;
}

const READ = /(^|[._])(get|list|read|search|fetch|view|find|query|describe|show|lookup)/i;
const HIGH = /(delete|drop|pay|transfer|send|exec|run|shell|pull_request|create_pr|merge|push|post|publish|grant|share|invite|wire)/i;
const CONTROL = /^(to|cc|bcc|recipients?|email|url|repo|repository|owner|channel|account|iban|path|file|command|cmd|host|target|destination|webhook)$/i;
const SINK = /^(body|text|content|message|description|comment|title|summary)$/i;
const STOP = new Set(["get", "list", "read", "search", "fetch", "view", "find", "create", "add", "update", "delete", "set", "run", "make", "do", "the"]);

export function hashTool(t: Tool): string {
  return createHash("sha256").update(JSON.stringify({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema })).digest("hex");
}

/** Infers an AgentShield tool spec from an MCP tool definition. Conservative by design. */
export function inferSpec(server: string, t: Tool) {
  const params = Object.keys((t.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {});
  const effect = READ.test(t.name) ? "read" : "write";
  const control = params.filter((p) => CONTROL.test(p));
  const sinks = effect === "write" ? params.filter((p) => SINK.test(p)) : [];
  return {
    name: `${server}.${t.name}`,
    app: server,
    description: t.description ?? "",
    effect,
    tier: effect === "read" ? "LOW" : HIGH.test(t.name) ? "HIGH" : "MEDIUM",
    keywords: t.name.split(/[_.\-]/).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase())),
    scopeArg: control.find((p) => /^(repo|repository|channel|to)$/i.test(p)),
    controlArgs: control,
    sinkArgs: Object.fromEntries(sinks.map((p) => [p, "PUBLIC"])),
    params: Object.fromEntries(params.map((p) => [p, p])),
  } as const;
}

async function core<T>(base: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.error ?? res.statusText}`);
  return json as T;
}

export async function startProxy(o: ProxyOptions) {
  const log = o.log ?? ((m: string) => process.stderr.write(`[agentshield] ${m}\n`));
  const pinsFile = o.pinsFile ?? join(homedir(), ".agentshield", "pins", `${o.serverName}.json`);
  const pins: Record<string, string> = existsSync(pinsFile) ? JSON.parse(readFileSync(pinsFile, "utf8")) : {};

  const upstream = new Client({ name: "agentshield-proxy", version: "0.1.0" });
  // pass the environment through: real servers need their tokens (GITHUB_TOKEN etc.)
  await upstream.connect(new StdioClientTransport({ command: o.command, args: o.args, stderr: "inherit",
    env: Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string")) }));

  // ---- manifest pinning + tool-poisoning scan
  const quarantined = new Map<string, string>();
  const listed = (await upstream.listTools()).tools;
  const allowed: Tool[] = [];
  let pinsChanged = false;
  for (const t of listed) {
    const h = hashTool(t);
    if (pins[t.name] && pins[t.name] !== h) {
      quarantined.set(t.name, "tool definition changed after it was approved (possible rug pull)");
      continue;
    }
    const { score } = await core<{ score: number }>(o.core, "/v1/scan", { text: `${t.description ?? ""} ${JSON.stringify(t.inputSchema)}` });
    if (score >= 0.5) {
      quarantined.set(t.name, `tool description looks like an injection (score ${score})`);
      continue;
    }
    if (!pins[t.name]) {
      pins[t.name] = h;
      pinsChanged = true;
    }
    allowed.push(t);
  }
  if (pinsChanged) {
    mkdirSync(dirname(pinsFile), { recursive: true });
    writeFileSync(pinsFile, JSON.stringify(pins, null, 2));
  }
  for (const [n, why] of quarantined) log(`quarantined ${n}: ${why}`);

  await core(o.core, "/v1/tools", { tools: allowed.map((t) => inferSpec(o.serverName, t)) });
  const session = await core<{ sessionId: string; contract: { allow: { tool: string }[] } }>(o.core, "/v1/sessions", {
    task: o.task, agentId: o.agentId ?? `mcp:${o.serverName}`, tools: allowed.map((t) => `${o.serverName}.${t.name}`), preset: o.preset,
  });
  log(`session ${session.sessionId}: contract allows ${session.contract.allow.map((a) => a.tool).join(", ") || "nothing"}`);

  // ---- the server side the MCP client talks to
  const server = new Server({ name: `agentshield:${o.serverName}`, version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allowed }));
  let seq = 0;
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    if (quarantined.has(name)) {
      return { isError: true, content: [{ type: "text" as const, text: `Blocked by AgentShield: ${quarantined.get(name)}` }] };
    }
    const call = { id: `mcp-${++seq}`, tool: `${o.serverName}.${name}`, args };
    const d = await core<{ verdict: string; reasons: string[] }>(o.core, "/v1/check", { sessionId: session.sessionId, call });
    if (d.verdict !== "ALLOW") {
      log(`${d.verdict} ${name}: ${d.reasons.join("; ")}`);
      return { isError: true, content: [{ type: "text" as const, text: `Blocked by AgentShield (${d.verdict}): ${d.reasons.join("; ")}` }] };
    }
    const result = await upstream.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text?: string }[] | undefined)?.map((c) => c.text ?? "").join("\n") ?? "";
    await core(o.core, "/v1/result", { sessionId: session.sessionId, call, output: text });
    return result;
  });
  await server.connect(new StdioServerTransport());
  return { sessionId: session.sessionId, quarantined };
}
