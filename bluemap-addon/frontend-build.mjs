import { mkdir, readFile, readdir, rm, stat, watch, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, "src");
async function projectVersion() {
  const releaseVersion = process.env.PLAYER_HISTORY_VERSION?.trim();
  if (releaseVersion) return releaseVersion;

  const cwd = join(root, "..");
  const [{ stdout: shaOutput }, { stdout: tagOutput }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "--short=8", "HEAD"], { cwd }),
    execFileAsync("git", ["tag", "--merged", "HEAD", "--list", "v*"], { cwd }),
  ]);
  const sha = shaOutput.trim().toLowerCase();
  if (!/^[0-9a-f]{7,8}$/.test(sha)) throw new Error("Could not determine Git SHA");

  const versions = tagOutput
    .split(/\r?\n/)
    .map((tag) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim()))
    .filter(Boolean)
    .map((match) => match.slice(1).map(Number))
    .sort((left, right) => right[0] - left[0] || right[1] - left[1] || right[2] - left[2]);
  // Hosted/shallow Git checkouts (for example Vercel) may not contain release tags.
  // The SHA still gives the frontend an immutable cache-busting version; normal CI and
  // release builds continue to derive the dev version from the latest stable tag.
  if (!versions.length) return `0.0.0-dev.${sha}`;
  return `${versions[0].join(".")}-dev.${sha}`;
}

export const outputDirectory = join(root, "dist");
export const scriptOutput = join(outputDirectory, "player-history.js");
export const developmentScriptOutput = join(outputDirectory, ".player-history.js.next");
export const styleOutput = join(outputDirectory, "player-history.css");

// Equipment/Curios rendering, player-follow UI and the live world-status controller are intentional browser features.
const maximumBundleSize = 288 * 1024;
const execFileAsync = promisify(execFile);

export async function copyStyles() {
  await mkdir(outputDirectory, { recursive: true });
  await build({
    entryPoints: [join(source, "player-history.css")],
    outfile: styleOutput,
    bundle: true,
    minify: true,
    logLevel: "warning",
  });
}

export async function verifyBundleSize(file = scriptOutput) {
  const bundle = await stat(file);
  const metrics = JSON.parse(
    await readFile(join(outputDirectory, "player-history-build.json"), "utf8"),
  );
  if (bundle.size + metrics.initialBytes > maximumBundleSize) {
    throw new Error(`Frontend bundle is too large: ${bundle.size} bytes`);
  }
  return bundle.size;
}

export async function createFrontendBuild({ onResult, outfile = scriptOutput } = {}) {
  await mkdir(outputDirectory, { recursive: true });
  const version = await projectVersion();
  if (!/^[A-Za-z0-9.+-]+$/.test(version)) throw new Error("Invalid frontend asset version");
  const modules = join(outputDirectory, "modules", version);
  return context({
    entryPoints: {
      live: join(source, "player-history.ts"),
      history: join(source, "history-runtime.ts"),
      diorama: join(source, "diorama-entry.ts"),
    },
    outdir: modules,
    splitting: true,
    metafile: true,
    chunkNames: "chunks/[name]-[hash]",
    bundle: true,
    format: "esm",
    target: "es2022",
    legalComments: "none",
    sourcemap: false,
    minify: true,
    logLevel: onResult ? "silent" : "warning",
    define: {
      __PLAYER_HISTORY_VERSION__: JSON.stringify(version),
    },
    plugins: [
      {
        name: "player-history-build-assets",
        setup(build) {
          build.onEnd(async (result) => {
            if (!result.errors.length) {
              const files = (await readdir(modules, { recursive: true }))
                .filter((file) => file.endsWith(".js"))
                .sort();
              const outputs = result.metafile.outputs;
              const live = Object.keys(outputs).find((file) =>
                outputs[file].entryPoint?.endsWith("player-history.ts"),
              );
              const visited = new Set();
              const initialSize = (file) => {
                if (visited.has(file)) return 0;
                visited.add(file);
                return (
                  outputs[file].bytes +
                  outputs[file].imports
                    .filter((entry) => entry.kind !== "dynamic-import" && outputs[entry.path])
                    .reduce((total, entry) => total + initialSize(entry.path), 0)
                );
              };
              await writeFile(
                join(outputDirectory, "player-history-build.json"),
                JSON.stringify({
                  initialBytes: initialSize(live),
                  totalBytes: Object.values(outputs).reduce(
                    (total, output) => total + output.bytes,
                    0,
                  ),
                }),
              );
              await writeFile(
                join(outputDirectory, "player-history-assets.json"),
                JSON.stringify(files.map((file) => `modules/${version}/${file}`)),
              );
              await writeFile(
                join(outputDirectory, "diorama-history.js"),
                `import "./modules/${version}/diorama.js";\n`,
              );
              const url = `player-history/modules/${version}/live.js`;
              await writeFile(
                outfile,
                `(()=>{const s=document.createElement("script");s.type="module";s.src=new URL(${JSON.stringify(url)},document.baseURI).href;s.onerror=()=>console.error("Player History live module could not load");document.body.append(s)})();\n`,
              );
            }
            if (onResult) await onResult(result);
          });
        },
      },
    ],
  });
}

export async function cleanOutput() {
  await rm(outputDirectory, { recursive: true, force: true });
}

export function watchStyles({ onSuccess, onError }) {
  const controller = new AbortController();
  const task = (async () => {
    let lastCopy = 0;
    try {
      for await (const _event of watch(source, {
        recursive: true,
        signal: controller.signal,
      })) {
        if (Date.now() - lastCopy < 50) continue;
        try {
          await copyStyles();
          lastCopy = Date.now();
          await onSuccess();
        } catch (error) {
          onError(error);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) onError(error);
    }
  })();

  return {
    close() {
      controller.abort();
    },
    task,
  };
}
