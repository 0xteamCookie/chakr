import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./crypto.js";

mkdirSync(DATA_DIR, { recursive: true });
process.env.DATABASE_URL ??= `file:${join(DATA_DIR, "agentshield.db")}`;

export const db = new PrismaClient();
