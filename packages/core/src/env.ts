// Loads the repo-root .env (if present) without overriding variables that are already set.
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, "../../../.env");
if (existsSync(file)) {
  try {
    for (const [k, v] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch { /* unreadable .env is not fatal */ }
}
