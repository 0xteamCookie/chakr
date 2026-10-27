"""LangChain adapter: every tool run goes through check -> execute -> result.

    shield = Shield.from_request(user_prompt)
    safe_tools = shield.wrap_langchain_tools(tools)   # or wrap_langchain_tools(shield, tools)

Tool names must match the names registered with Shield.register_tools().
"""

from __future__ import annotations

from typing import Any, Sequence

from langchain_core.tools import BaseTool, StructuredTool

from .client import Shield, ShieldBlockedError, blocked_payload


def wrap_langchain_tools(shield: Shield, tools: Sequence[BaseTool]) -> list[BaseTool]:
    """Return StructuredTools that behave like `tools` but run through the shield.

    Blocked calls hand the structured block dict back to the model (shield.on_block == "return")
    or raise ShieldBlockedError ("throw").
    """
    return [_wrap_one(shield, t) for t in tools]


def _wrap_one(shield: Shield, tool: BaseTool) -> BaseTool:
    name = tool.name

    def _guarded(**kwargs: Any) -> Any:
        cid = shield.next_id()
        d = shield.check(name, kwargs, cid)
        if not d.allowed:
            if shield.on_block == "throw":
                raise ShieldBlockedError(name, d)
            return blocked_payload(d)
        output = tool.invoke(kwargs)  # the original tool's own run path
        shield.result(name, kwargs, output, cid)
        return output

    return StructuredTool(
        name=name,
        description=tool.description,
        args_schema=tool.args_schema,
        func=_guarded,
        return_direct=getattr(tool, "return_direct", False),
    )
