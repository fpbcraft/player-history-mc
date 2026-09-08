import { mkdir, readFile, writeFile, readdir, watch } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL(".", import.meta.url));
const { version } = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const names = [
  "player-history.js",
  "replay-core.js",
  "replay-state.js",
  "bluemap-adapter.js",
  "telemetry.js",
  "player-history.css",
];
const versioned = (name) => name.replace(/\.(js|css)$/, `-${version}.$1`);
async function build() {
  const destinations = [join(root, "dist")];
  if (process.env.BLUEMAP_WEBROOT)
    destinations.push(join(process.env.BLUEMAP_WEBROOT, "player-history"));
  for (const dest of destinations) {
    await mkdir(dest, { recursive: true });
    for (const name of names) {
      let content = await readFile(join(root, "src", name), "utf8");
      for (const dependency of names)
        content = content.replaceAll(
          new RegExp(
            dependency.replaceAll(".", "\\.") + "(?:\\?v=[0-9.]+)?",
            "g",
          ),
          versioned(dependency),
        );
      await writeFile(join(dest, versioned(name)), content);
    }
  }
  console.log(`Built versioned history assets ${version}`);
}
await build();
if (process.argv.includes("--watch"))
  for await (const event of watch(join(root, "src"))) await build();
