import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../crypto.js";
import { runInjecAgentEval } from "./injecagent.js";

const report = await runInjecAgentEval();
mkdirSync(DATA_DIR, { recursive: true });
const out = join(DATA_DIR, "eval-results.json");
writeFileSync(out, JSON.stringify(report, null, 2));

const pad = (s: string | number, n: number) => String(s).padEnd(n);
console.log(`\n${report.dataset}: ${report.cases.total} attacks (${report.cases.directHarm} direct harm, ${report.cases.dataStealing} data stealing)`);
console.log(`Threat model: ${report.threatModel}\n`);
console.log(pad("Configuration", 26) + pad("ASR %", 9) + pad("executed", 10) + pad("escalated", 11) + pad("denied", 8) + "false blocks %");
for (const r of [...report.configs, ...report.stress]) {
  console.log(pad(r.label + (r.key.endsWith("overlap") ? " *" : ""), 26) + pad(r.asr, 9) + pad(r.executed, 10) +
    pad(r.escalated, 11) + pad(r.denied, 8) + r.falseBlockRate);
}
console.log("* capability overlap: the attacker's tools are inside the contract\n");
console.log("Obfuscated attacker values traced (with / without de-obfuscation):");
for (const o of report.obfuscation) console.log(`  ${pad(o.method, 16)} ${o.tracedWith}/${o.cases}  vs  ${o.tracedWithout}/${o.cases}`);
console.log(`\nHeuristic detector flags ${report.detector.rate}% of injected tool responses (advisory only).`);
console.log(`Decision latency: p50 ${report.latency.p50} ms, p95 ${report.latency.p95} ms over ${report.latency.checks} checks.`);
console.log(`\nSaved to ${out} (${report.durationMs} ms)`);
