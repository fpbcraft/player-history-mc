import { copyFile, mkdir, rm, stat, watch } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { context } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, "src");
const destinations = [
  join(root, "dist"),
  ...(process.env.BLUEMAP_WEBROOT ? [join(process.env.BLUEMAP_WEBROOT, "player-history")] : []),
];

const copyStyles = async () => {
  await Promise.all(
    destinations.map(async (destination) => {
      await mkdir(destination, { recursive: true });
      await copyFile(join(source, "player-history.css"), join(destination, "player-history.css"));
    }),
  );
};

const buildDestination = async (destination) => {
  await mkdir(destination, { recursive: true });
  const build = await context({
    entryPoints: [join(source, "player-history.ts")],
    outfile: join(destination, "player-history.js"),
    bundle: true,
    format: "iife",
    target: "es2022",
    legalComments: "none",
    sourcemap: false,
    minify: false,
    logLevel: "warning",
  });
  await build.rebuild();
  return build;
};

for (const destination of destinations) await rm(destination, { recursive: true, force: true });
const builds = await Promise.all(destinations.map(buildDestination));
await copyStyles();

const bundle = await stat(join(destinations[0], "player-history.js"));
if (bundle.size > 250 * 1024) throw new Error(`Frontend bundle is too large: ${bundle.size} bytes`);
console.log(`Built player-history.js (${bundle.size} bytes) and player-history.css`);

if (process.argv.includes("--watch")) {
  await Promise.all(builds.map((build) => build.watch()));
  for await (const event of watch(source)) {
    if (event.filename === "player-history.css") await copyStyles();
  }
} else {
  await Promise.all(builds.map((build) => build.dispose()));
}
