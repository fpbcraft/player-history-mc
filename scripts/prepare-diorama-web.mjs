import { mkdir, cp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output") throw Error("Usage: node scripts/prepare-diorama-web.mjs --output NEW_STAGING_DIRECTORY (run the frontend build first)");
const output = resolve(args[1]);
// Deliberately refuse existing destinations: preparation cannot replace a live site.
await mkdir(output);
const assets = join(output, "player-history");
await mkdir(assets);
for (const file of ["diorama-history.js", "player-history.css", "modules"]) {
  await cp(join(root, "bluemap-addon/dist", file), join(assets, file), { recursive: true, errorOnExist: true });
}
await mkdir(join(output, "diorama"));
await writeFile(join(output, "diorama/extensions.json"), JSON.stringify({ scripts: ["/player-history/diorama-history.js"], styles: ["/player-history/player-history.css"] }, null, 2) + "\n");
await writeFile(join(output, "README.txt"), "Staged public viewer assets only. Copy diorama/extensions.json into the Diorama map output and serve player-history/ at /player-history/. Proxy /player-history/data/ to the recorder PUBLIC directory, and /player-history-api/ to the existing recorder API. No history, skins, tokens, sessions or private files are copied here. See docs/diorama-web.md.\n");
console.log(`Prepared public viewer assets in ${output}; no deployment performed.`);
