# agentshield (Python SDK)

Python mirror of `packages/sdk`: put the AgentShield core in front of any agent's tools.

```bash
cd python
python -m venv .venv && .venv/Scripts/activate      # source .venv/bin/activate on Linux/macOS
pip install -e ".[examples,test]"                   # core extra: pip install -e .   (httpx only)
cd ../packages/core && pnpm dev                     # core on :4317 (or set AGENTSHIELD_URL)
```

```python
from agentshield import Shield, ToolSpec

Shield.register_tools([ToolSpec(name="send_email", app="mail", effect="write", tier="HIGH",
                                keywords=["send", "email"], scope_arg="to", control_args=["to"],
                                params={"to": "recipient", "body": "text"})])
shield = Shield.from_request("Email bob@example.com the notes", agent_id="my-agent", preset="balanced")
safe_send = shield.wrap(send_email)                 # callable, {name: callable} or [callables]
safe_send(to="evil@x.com", body="...")              # -> {"blocked_by_agentshield": True, "verdict": "DENY", ...}
```

- `check(tool, args)` / `result(tool, args, output, id)` are the raw protocol calls (`/v1/check`, `/v1/result`).
- `on_block="throw"` raises `ShieldBlockedError` instead of returning the structured dict.
- `shield.wrap_langchain_tools(tools)` (see `agentshield/langchain.py`) returns LangChain `StructuredTool`s
  that run check -> execute -> result. Example: `examples/langchain_agent.py` (Gemini; needs
  `GOOGLE_GENERATIVE_AI_API_KEY` in the environment or the repo-root `.env`, exits with a clear message otherwise).
- The core keeps registered tools and sessions in memory: re-register after a core restart. Declare every argument
  a tool takes in `params`, the core rejects undeclared arguments.
- Tests: `pytest` (integration tests against the live core, skipped if it is not running).
