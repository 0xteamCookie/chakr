// Downloads the ONNX export of Llama Prompt Guard 2 (86M, int8, ~280 MB) into .data/models/prompt-guard-2-86m.
// Usage: pnpm --filter @agentshield/core model:fetch
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promptGuardDir } from "../src/promptguard.js";

const REPO = "https://huggingface.co/gravitee-io/Llama-Prompt-Guard-2-86M-onnx/resolve/main";
const FILES: [string, string][] = [
  ["config.json", "config.json"], ["tokenizer.json", "tokenizer.json"], ["tokenizer_config.json", "tokenizer_config.json"],
  ["special_tokens_map.json", "special_tokens_map.json"], ["LICENSE", "LICENSE"], ["model.quant.onnx", "onnx/model_quantized.onnx"],
];

const dir = promptGuardDir();
mkdirSync(join(dir, "onnx"), { recursive: true });
for (const [remote, local] of FILES) {
  const to = join(dir, local);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${REPO}/${remote}`);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const size = Number(res.headers.get("content-length") ?? 0);
      if (existsSync(to) && size && statSync(to).size === size) { console.log(`ok   ${local} (cached)`); await res.body.cancel(); break; }
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(to));
      if (size && statSync(to).size !== size) throw new Error("incomplete download");
      console.log(`got  ${local} (${(statSync(to).size / 1e6).toFixed(1)} MB)`);
      break;
    } catch (e) {
      if (attempt >= 5) throw e;
      console.log(`retry ${local}: ${(e as Error).message}`);
    }
  }
}
console.log(`Prompt Guard 2 is in ${dir}. Restart the core to use it.`);
