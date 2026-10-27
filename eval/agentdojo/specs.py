"""Derive AgentShield ToolSpecs from AgentDojo tool names and signatures (no hand-written per-tool table)."""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))  # use the in-repo SDK without installing

from agentshield import ToolSpec  # noqa: E402

READ_VERBS = {"get", "read", "search", "list", "find", "check", "view", "fetch", "show", "browse"}
# send_/transfer/delete/create/post and other irreversible or outward-facing actions
HIGH_VERBS = {"send", "transfer", "delete", "create", "post", "remove", "share", "invite", "add", "forward",
              "reply", "pay", "cancel", "reserve", "book", "reschedule", "schedule"}
MEDIUM_VERBS = {"update", "set", "change", "append", "move", "copy", "rename", "write"}

# words a user may use for the action a tool performs (the contract compiler matches request words to keywords)
SYNONYMS = {
    "send": ["send", "pay", "transfer", "refund", "email", "message", "mail", "write", "tell", "notify", "dm"],
    "transfer": ["transfer", "send", "pay"],
    "money": ["money", "pay", "payment", "bill", "rent", "refund"],
    "delete": ["delete", "remove", "erase", "clear"],
    "remove": ["remove", "delete", "kick"],
    "create": ["create", "add", "new", "make", "schedule", "set up", "book"],
    "add": ["add", "invite", "create", "include", "put"],
    "post": ["post", "publish", "write", "put"],
    "share": ["share", "give access", "send"],
    "invite": ["invite", "add"],
    "cancel": ["cancel", "delete", "remove"],
    "reschedule": ["reschedule", "move", "change", "postpone"],
    "schedule": ["schedule", "recurring", "standing order", "subscription", "set up"],
    "reserve": ["reserve", "book", "reservation"],
    "update": ["update", "change", "modify", "edit", "set", "adjust", "rename"],
    "append": ["append", "add", "write", "extend"],
    "reply": ["reply", "respond", "answer"],
    "forward": ["forward", "send"],
}
STOP = {"get", "the", "in", "for", "by", "to", "of", "all", "and", "info", "information", "current"}

# Optional per-suite vocabulary an integrator would add for READ tools (low risk), so that ordinary phrasing like
# "my spending" reaches get_most_recent_transactions. Writes never get these: they need an explicit action word.
DOMAIN_WORDS = {
    "banking": ["balance", "spending", "spent", "transaction", "payment", "account", "bill", "rent", "iban",
                "file", "subscription", "statement", "landlord", "money", "refund", "pay", "scheduled"],
    "slack": ["channel", "message", "inbox", "user", "website", "webpage", "slack", "post", "read", "summarize"],
    "workspace": ["email", "calendar", "event", "meeting", "file", "document", "contact", "schedule", "inbox", "drive"],
    "travel": ["hotel", "restaurant", "car", "rental", "flight", "trip", "price", "rating", "review", "city", "travel"],
}

CONTROL_ARGS = {"recipient", "recipients", "iban", "to", "email", "emails", "cc", "bcc", "channel", "user", "users",
                "url", "participants", "participant", "attachments"}
CONTENT_ARGS = {"body", "message", "content", "text"}


def _tokens(name: str) -> list[str]:
    return [t for t in name.lower().split("_") if t]


def _verb_effect(name: str) -> tuple[str, str]:
    toks = _tokens(name)
    first = toks[0]
    if first in READ_VERBS:
        return "read", "LOW"
    if "password" in toks:
        return "write", "HIGH"
    verbs = [t for t in toks if t in HIGH_VERBS | MEDIUM_VERBS]
    if first in HIGH_VERBS or any(v in HIGH_VERBS for v in verbs):
        return "write", "HIGH"
    if first in MEDIUM_VERBS or verbs:
        return "write", "MEDIUM"
    return "write", "MEDIUM"  # unknown verb: be conservative



def derive_spec(fn, app: str, domain_words: bool = True) -> ToolSpec:
    """Build a ToolSpec for one AgentDojo Function."""
    effect, tier = _verb_effect(fn.name)
    params = list(fn.parameters.model_fields)
    toks = _tokens(fn.name)
    keywords: list[str] = []
    for t in toks:
        if t in STOP:
            continue
        keywords.append(t)
        keywords.extend(SYNONYMS.get(t, []))
    if effect == "read":
        # reads are low risk and untrusted-labelled anyway: let words from the description grant them too
        keywords.extend(w for w in re.findall(r"[a-z]{4,}", (fn.description or "").lower()) if w not in STOP)
    if effect == "read" and domain_words:
        keywords.extend(DOMAIN_WORDS.get(app, []))
    keywords = sorted(set(keywords))
    sink_vis = "PUBLIC" if toks[0] == "post" else "INTERNAL"
    return ToolSpec(
        name=fn.name,
        app=app,
        description=(fn.description or "").strip().split("\n")[0][:200],
        effect=effect,  # type: ignore[arg-type]
        tier=tier,  # type: ignore[arg-type]
        keywords=keywords,
        control_args=[p for p in params if p in CONTROL_ARGS] if effect == "write" else None,
        sink_args={p: sink_vis for p in params if p in CONTENT_ARGS} if effect == "write" else None,  # type: ignore[misc]
        output_integrity="UNTRUSTED",
        output_confidentiality="PRIVATE",
        params={p: p for p in params},
    )


def derive_specs(suite, domain_words: bool = True) -> list[ToolSpec]:
    return [derive_spec(f, suite.name, domain_words) for f in suite.tools]
