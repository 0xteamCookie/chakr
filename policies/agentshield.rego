# Org policy for AgentShield, evaluated by Open Policy Agent when OPA_URL is set.
# Mirrors the built-in evaluator in packages/core/src/policy.ts.
#   docker run -p 8181:8181 -v $PWD/policies:/policies openpolicyagent/opa run --server /policies
#   OPA_URL=http://localhost:8181 pnpm dev:core
package agentshield

import rego.v1

limits := {"payments.pay": {"amount": 50000}}

require_approval := {"payments.pay"}

forbidden_patterns := [
	{"tool": "shell.exec", "arg": "command", "pattern": `rm\s+-rf|mkfs|curl[^|]*\|\s*(ba)?sh`, "reason": "destructive or remote-exec shell command"},
	{"tool": "db.query", "arg": "sql", "pattern": `(?i)\b(drop|truncate)\s+table\b`, "reason": "schema-destroying SQL"},
]

forbidden_reasons contains f.reason if {
	some f in forbidden_patterns
	f.tool == input.tool
	regex.match(f.pattern, sprintf("%v", [input.args[f.arg]]))
}

limit_reasons contains sprintf("%s %v is above the limit of %v", [arg, input.args[arg], max]) if {
	some arg, max in limits[input.tool]
	to_number(input.args[arg]) > max
}

approval_reasons contains sprintf("%s always needs a human", [input.tool]) if input.tool in require_approval

decision := {"verdict": "DENY", "tier": "FORBIDDEN", "reasons": [r | some r in forbidden_reasons]} if {
	count(forbidden_reasons) > 0
} else := {"verdict": "ESCALATE", "tier": "HIGH", "reasons": array.concat([r | some r in limit_reasons], [r | some r in approval_reasons])} if {
	count(limit_reasons) + count(approval_reasons) > 0
} else := {"verdict": null, "tier": input.tier, "reasons": []}
