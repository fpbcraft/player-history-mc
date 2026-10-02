import { mkdir, rm, stat, watch } from "node:fs/promises";
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
    .sort((left, right) =>
      right[0] - left[0] || right[1] - left[1] || right[2] - left[2],
    );
  if (!versions.length) throw new Error("Could not determine stable release tag");
  return `${versions[0].join(".")}-dev.${sha}`;
}

export const outputDirectory = join(root, "dist");
export const scriptOutput = join(outputDirectory, "player-history.js");
export const developmentScriptOutput = join(outputDirectory, ".player-history.js.next");
export const styleOutput = join(outputDirectory, "player-history.css");

// Textured avatar equipment added a small amount of intentional runtime code.
const maximumBundleSize = 256 * 1024;
const execFileAsync = promisify(execFile);

export async function copyStyles() {
  await mkdir(outputDirectory, { recursive: true });
  await build({
    entryPoints: [join(source, "player-history.css")],
    outfile: styleOutput,
    bundle: true,
    minify: false,
    logLevel: "warning",
  });
}

export async function verifyBundleSize(file = scriptOutput) {
  const bundle = await stat(file);
  if (bundle.size > maximumBundleSize) {
    throw new Error(`Frontend bundle is too large: ${bundle.size} bytes`);
  }
  return bundle.size;
}

export async function createFrontendBuild({ onResult, outfile = scriptOutput } = {}) {
  await mkdir(outputDirectory, { recursive: true });
  const version = await projectVersion();
  return context({
    entryPoints: [join(source, "player-history.ts")],
    outfile,
    bundle: true,
    format: "iife",
    target: "es2022",
    legalComments: "none",
    sourcemap: false,
    minify: false,
    logLevel: onResult ? "silent" : "warning",
    define: {
      __PLAYER_HISTORY_VERSION__: JSON.stringify(version),
    },
    plugins: onResult
      ? [
          {
            name: "player-history-build-status",
            setup(build) {
              build.onEnd((result) => onResult(result));
            },
          },
        ]
      : [],
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
