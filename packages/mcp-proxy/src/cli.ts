#!/usr/bin/env -S npx tsx
// Usage:
//   agentshield-mcp --name github --task "Triage the open issues in acme/website" -- npx some-github-mcp-server
//
// Options: --name <server> --task <text> (or AGENTSHIELD_TASK) --agent <id> --core <url> --preset <p> --pins <file>

import { startProxy } from "./proxy.js";

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
if (split < 0 || split === argv.length - 1) {
  process.stderr.write("usage: agentshield-mcp --name <server> --task <text> -- <command> [args...]\n");
  process.exit(2);
}
const flags = argv.slice(0, split);
const [command, ...args] = argv.slice(split + 1);
const get = (f: string) => {
  const i = flags.indexOf(f);
  return i >= 0 ? flags[i + 1] : undefined;
};

const task = get("--task") ?? process.env.AGENTSHIELD_TASK;
if (!task) {
  process.stderr.write("agentshield-mcp: the user's task is required (--task or AGENTSHIELD_TASK). " +
    "It must come from the user, never from the model, because it defines the intent contract.\n");
  process.exit(2);
}

await startProxy({
  serverName: get("--name") ?? "upstream",
  command,
  args,
  task,
  agentId: get("--agent"),
  core: get("--core") ?? process.env.AGENTSHIELD_URL ?? "http://localhost:4317",
  preset: (get("--preset") as "strict" | "balanced" | "permissive" | undefined) ?? "balanced",
  pinsFile: get("--pins"),
});
