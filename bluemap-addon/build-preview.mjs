import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { dioramaWebFiles, pinnedDioramaRef } from "./diorama-preview-assets.mjs";
const root = dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [join(root, "build.mjs")], { stdio: "inherit" });
const ref = pinnedDioramaRef(await readFile(join(root, "../.github/workflows/ci.yml"), "utf8"));
const response = await fetch(`https://codeload.github.com/fpbcraft/diorama/tar.gz/${ref}`, {
  signal: AbortSignal.timeout(60000),
});
if (!response.ok) throw Error(`Cannot fetch pinned Diorama source: HTTP ${response.status}`);
const archive = await response.arrayBuffer();
if (archive.byteLength > 32 * 1024 * 1024) throw Error("Diorama source archive too large");
const files = dioramaWebFiles(Buffer.from(archive));
for (const [file, content] of files) {
  const output = join(root, "dist", file);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, content);
}
// Always load the PR's extension, regardless of the backend JAR's frontend version.
await writeFile(
  join(root, "dist/extensions.auto.json"),
  JSON.stringify({
    scripts: ["/player-history/diorama-history.js"],
    styles: ["/player-history/player-history.css"],
  }),
);
await writeFile(
  join(root, "dist/frontend-preview.json"),
  JSON.stringify(
    {
      dioramaCommit: ref,
      playerHistoryCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
      backend: "https://map.fpbcraft.com",
    },
    null,
    2,
  ),
);
console.log(`Prepared Diorama frontend preview from ${ref}`);
