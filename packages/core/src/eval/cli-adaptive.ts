import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../crypto.js";
import { runAdaptiveEval } from "./adaptive.js";

const report = await runAdaptiveEval();
mkdirSync(DATA_DIR, { recursive: true });
const out = join(DATA_DIR, "adaptive-results.json");
writeFileSync(out, JSON.stringify(report, null, 2));

const pad = (s: string | number, n: number) => String(s).padEnd(n);
console.log(`
Adaptive attack suite: ${report.variants.length} variants against a fully compromised agent`);
console.log(`Threat model: ${report.threatModel}
`);
console.log(pad("Category", 30) + pad("variants", 10) + pad("blocked", 9) + pad("escalated", 11) + pad("executed", 10) + pad("misled", 8) + "executed w/o causal");
for (const c of report.categories) {
  console.log(pad(c.category, 30) + pad(c.variants, 10) + pad(c.blocked, 9) + pad(c.escalated, 11) + pad(c.executed, 10) + pad(c.misled, 8) + c.deterministicExecuted);
}
const hit = report.variants.filter((v) => v.success);
console.log(`
Variants that succeed (${hit.length}):`);
for (const v of hit) console.log(`  ${pad(v.id, 30)} ${v.outcome}${v.misled ? ` [${v.misled}]` : ""}${v.known ? "  (known limit)" : "  (BYPASS)"}`);
console.log(`
Unexplained bypasses: ${report.bypasses.length ? report.bypasses.join(", ") : "none"}`);
console.log(`Known limits: ${report.known.map((k) => k.id).join(", ")}`);
console.log(`
Saved to ${out} (${report.durationMs} ms)`);
