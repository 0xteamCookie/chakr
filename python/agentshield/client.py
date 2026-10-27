"""Shield client: register tools, open a session from the user's request, check and label tool calls.

    Shield.register_tools([ToolSpec(name="send_email", app="mail", effect="write", tier="HIGH")])
    shield = Shield.from_request("Email Bob the report", agent_id="my-agent")
    safe_send = shield.wrap(send_email)           # or shield.wrap({"send_email": send_email})

Every call is checked by the core before it runs and every result is labelled on the way back.
A blocked call returns a structured dict to the model (default) or raises ShieldBlockedError.
"""

from __future__ import annotations

import functools
import inspect
import itertools
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Literal, Mapping, Sequence

import httpx

DEFAULT_URL = "http://localhost:4317"


def default_url() -> str:
    return os.environ.get("AGENTSHIELD_URL") or DEFAULT_URL


@dataclass
class ToolSpec:
    name: str
    app: str
    effect: Literal["read", "write"]
    tier: Literal["LOW", "MEDIUM", "HIGH", "FORBIDDEN"]
    description: str = ""
    keywords: list[str] = field(default_factory=list)
    scope_arg: str | None = None
    control_args: list[str] | None = None
    sink_args: dict[str, Literal["PUBLIC", "PRIVATE", "INTERNAL"]] | None = None
    output_integrity: Literal["TRUSTED", "UNTRUSTED"] | None = None
    output_confidentiality: Literal["PUBLIC", "PRIVATE", "SECRET"] | None = None
    params: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "name": self.name, "app": self.app, "description": self.description,
            "effect": self.effect, "tier": self.tier, "keywords": self.keywords, "params": self.params,
        }
        for key, val in (("scopeArg", self.scope_arg), ("controlArgs", self.control_args),
                         ("sinkArgs", self.sink_args), ("outputIntegrity", self.output_integrity),
                         ("outputConfidentiality", self.output_confidentiality)):
            if val is not None:
                d[key] = val
        return d


@dataclass
class Decision:
    verdict: str  # ALLOW | ESCALATE | DENY
    risk: str = "LOW"
    reasons: list[str] = field(default_factory=list)
    labels: list[dict[str, Any]] = field(default_factory=list)
    latency_ms: float = 0.0  # decision time inside the core (excludes waiting for a human)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def allowed(self) -> bool:
        return self.verdict == "ALLOW"

    @classmethod
    def from_json(cls, j: dict[str, Any]) -> "Decision":
        return cls(verdict=j["verdict"], risk=j.get("risk", "LOW"), reasons=list(j.get("reasons", [])),
                   labels=list(j.get("labels", [])), latency_ms=float(j.get("latencyMs", 0.0)), raw=j)


class ShieldBlockedError(Exception):
    def __init__(self, tool: str, decision: Decision):
        reason = decision.reasons[0] if decision.reasons else decision.verdict
        super().__init__(f"AgentShield blocked {tool}: {reason}")
        self.tool = tool
        self.decision = decision


def blocked_payload(d: Decision) -> dict[str, Any]:
    return {"blocked_by_agentshield": True, "verdict": d.verdict, "reasons": d.reasons}


_shared: httpx.Client | None = None


def _shared_client() -> httpx.Client:
    # one keep-alive connection pool: a fresh connection per call costs ~300 ms on Windows
    global _shared
    if _shared is None:
        _shared = httpx.Client()
    return _shared


def _post(url: str, path: str, body: Any, timeout: float, client: httpx.Client | None) -> Any:
    c = client or _shared_client()
    res = c.post(f"{url}{path}", json=body, timeout=timeout)
    try:
        data = res.json()
    except ValueError:
        data = {}
    if res.status_code >= 400:
        raise RuntimeError(f"AgentShield {path}: {data.get('error', res.reason_phrase)}")
    return data


def _jsonable(o: Any) -> Any:
    """Best-effort conversion so any tool output can be posted as JSON."""
    if o is None or isinstance(o, (str, int, float, bool)):
        return o
    if isinstance(o, Mapping):
        return {str(k): _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple, set)):
        return [_jsonable(v) for v in o]
    if hasattr(o, "model_dump"):
        return _jsonable(o.model_dump())
    return str(o)


class Shield:
    def __init__(self, url: str, session_id: str, contract: Any, on_block: Literal["return", "throw"] = "return",
                 timeout: float = 150.0, client: httpx.Client | None = None):
        self.url = url
        self.session_id = session_id
        self.contract = contract
        self.on_block = on_block
        self.timeout = timeout
        self._client = client
        self._seq = itertools.count(1)
        self.decisions: list[Decision] = []

    # -- setup -----------------------------------------------------------------------------
    @staticmethod
    def register_tools(tools: Iterable[ToolSpec | Mapping[str, Any]], url: str | None = None,
                       timeout: float = 30.0, client: httpx.Client | None = None) -> list[str]:
        """Describe your tools once so the core knows their effect, risk and sinks."""
        payload = [t.to_dict() if isinstance(t, ToolSpec) else dict(t) for t in tools]
        return _post(url or default_url(), "/v1/tools", {"tools": payload}, timeout, client)["registered"]

    @classmethod
    def from_request(cls, task: str, *, agent_id: str | None = None, tools: Sequence[str] | None = None,
                     preset: Literal["strict", "balanced", "permissive", "off"] | None = None,
                     settings: Mapping[str, Any] | None = None, system_prompt: str | None = None,
                     url: str | None = None, on_block: Literal["return", "throw"] = "return",
                     timeout: float = 150.0, client: httpx.Client | None = None) -> "Shield":
        """Compile and sign the intent contract from the user's request, before the agent reads anything."""
        url = url or default_url()
        body = {"task": task, "agentId": agent_id, "tools": list(tools) if tools is not None else None,
                "preset": preset, "settings": dict(settings) if settings else None, "systemPrompt": system_prompt}
        body = {k: v for k, v in body.items() if v is not None}
        s = _post(url, "/v1/sessions", body, timeout, client)
        return cls(url, s["sessionId"], s["contract"], on_block, timeout, client)

    # -- protocol --------------------------------------------------------------------------
    def next_id(self) -> str:
        return f"call-{next(self._seq)}"

    def check(self, tool: str, args: Mapping[str, Any] | None = None, id: str | None = None) -> Decision:
        """Ask the shield about one call. Escalations wait for a human in the dashboard (or time out to DENY)."""
        j = _post(self.url, "/v1/check", {"sessionId": self.session_id,
                  "call": {"id": id or self.next_id(), "tool": tool, "args": _jsonable(dict(args or {}))}},
                  self.timeout, self._client)
        d = Decision.from_json(j)
        self.decisions.append(d)
        return d

    def result(self, tool: str, args: Mapping[str, Any] | None, output: Any, id: str) -> None:
        """Label a tool result so later arguments can be traced back to it."""
        _post(self.url, "/v1/result", {"sessionId": self.session_id,
              "call": {"id": id, "tool": tool, "args": _jsonable(dict(args or {}))}, "output": _jsonable(output)},
              self.timeout, self._client)

    # -- wrapping --------------------------------------------------------------------------
    def guard(self, name: str, fn: Callable[..., Any]) -> Callable[..., Any]:
        """Wrap one callable. Positional arguments are mapped to parameter names for the check."""
        try:
            sig = inspect.signature(fn)
        except (TypeError, ValueError):
            sig = None

        def to_args(a: tuple, kw: dict) -> dict[str, Any]:
            if sig is None:
                return dict(kw)
            try:
                return dict(sig.bind_partial(*a, **kw).arguments)
            except TypeError:
                return dict(kw)

        @functools.wraps(fn)
        def wrapped(*a: Any, **kw: Any) -> Any:
            args = to_args(a, kw)
            cid = self.next_id()
            d = self.check(name, args, cid)
            if not d.allowed:
                if self.on_block == "throw":
                    raise ShieldBlockedError(name, d)
                return blocked_payload(d)
            out = fn(*a, **kw)
            self.result(name, args, out, cid)
            return out

        return wrapped

    def wrap(self, tools: Callable[..., Any] | Mapping[str, Callable[..., Any]] | Sequence[Callable[..., Any]],
             name: str | None = None):
        """Route tool callables through the shield.

        - a callable: returns a wrapped callable (name defaults to fn.__name__)
        - a dict {tool_name: callable}: returns a dict (keys must match the registered names)
        - a list of callables: returns a list (names from __name__)
        """
        if callable(tools):
            return self.guard(name or getattr(tools, "__name__", "tool"), tools)
        if isinstance(tools, Mapping):
            return {k: (self.guard(k, v) if callable(v) else v) for k, v in tools.items()}
        return [self.guard(getattr(t, "__name__", "tool"), t) for t in tools]

    def wrap_langchain_tools(self, tools: Sequence[Any]) -> list[Any]:
        """LangChain tools whose run path is check -> execute -> result (needs langchain-core)."""
        from .langchain import wrap_langchain_tools

        return wrap_langchain_tools(self, tools)
