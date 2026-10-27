// pnpm eval:llm [--setting base|enhanced] [--limit N] [--model claude-haiku-5-5] [--concurrency 8]
// Spends API credits: one to four model calls per case, plus a causal replay when it triggers.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../crypto.js";
import { runLlmEval } from "./injecagent-llm.js";

const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const limit = arg("--limit") ? Number(arg("--limit")) : undefined;
const setting = (arg("--setting") ?? "base") as "base" | "enhanced";
const report = await runLlmEval({
  model: arg("--model"), setting, limit, concurrency: arg("--concurrency") ? Number(arg("--concurrency")) : 8,
  onProgress: (d, t) => { if (d % 25 === 0 || d === t) process.stderr.write(`  ${d}/${t}\n`); },
});
mkdirSync(DATA_DIR, { recursive: true });
const out = join(DATA_DIR, limit ? `eval-llm-${setting}-pilot.json` : `eval-llm-${setting}.json`);
writeFileSync(out, JSON.stringify(report, null, 2));
const { results, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
console.log(`saved ${out}`);
