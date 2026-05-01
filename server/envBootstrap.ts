/**
 * Load `.env` from the repository root before any other server code reads
 * `process.env`. Default `dotenv/config` only reads from `process.cwd()`, which
 * breaks when the process is started from another directory or when the
 * bundled entry lives under `dist/`.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const entryDir = path.dirname(fileURLToPath(import.meta.url));

let envPath: string | undefined;
let dir = entryDir;
for (let i = 0; i < 12; i++) {
  const candidate = path.join(dir, ".env");
  if (fs.existsSync(candidate)) {
    envPath = candidate;
    break;
  }
  const parent = path.dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

if (envPath) dotenv.config({ path: envPath });
else dotenv.config();
