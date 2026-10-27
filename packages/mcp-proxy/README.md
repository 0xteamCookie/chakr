# @agentshield/mcp-proxy

Puts AgentShield between any MCP client and any MCP server, with no code changes.

```jsonc
// claude_desktop_config.json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["tsx", "/path/to/agentshield/packages/mcp-proxy/src/cli.ts",
               "--name", "github", "--task", "Triage the open issues in acme/website",
               "--", "npx", "-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "..." }
    }
  }
}
```

What it does on start-up: pins a SHA-256 hash of every tool definition (a later change is a rug pull and the tool is
hidden), scans tool descriptions for injected instructions (tool poisoning), registers the tools with the core and
compiles the intent contract from `--task`. Every `tools/call` is then checked by the core; results are labelled.

The task comes from the user (flag or `AGENTSHIELD_TASK`), never from the model. The causal check needs the model and
does not run in proxy mode; contract, provenance, policy and pinning do. `pnpm --filter @agentshield/mcp-proxy selftest`
runs the end-to-end check against the bundled demo server.
