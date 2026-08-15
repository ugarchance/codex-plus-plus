import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith(".mjs") && f !== "index.mjs")
  .sort((a, b) => a.localeCompare(b));

const patches = [];
for (const file of files) {
  const mod = await import(pathToFileURL(path.join(dir, file)).href);
  patches.push(mod.default ?? mod);
}

export default patches;
