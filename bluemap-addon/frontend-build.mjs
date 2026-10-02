import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, stat, watch } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, "src");
const gradleProperties = join(root, "..", "gradle.properties");

async function projectVersion() {
  const releaseVersion = process.env.PLAYER_HISTORY_VERSION?.trim();
  if (releaseVersion) return releaseVersion;

  const properties = await readFile(gradleProperties, "utf8");
  const match = properties.match(/^modVersion=(.+)$/m);
  if (!match?.[1]?.trim()) throw new Error("gradle.properties is missing modVersion");

  const shortSha = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], {
    cwd: join(root, ".."),
    encoding: "utf8",
  }).trim();
  if (!shortSha) throw new Error("Could not resolve the current Git commit");

  return `${match[1].trim()}-dev.${shortSha}`;
}

export const outputDirectory = join(root, "dist");
export const scriptOutput = join(outputDirectory, "player-history.js");
export const developmentScriptOutput = join(outputDirectory, ".player-history.js.next");
export const styleOutput = join(outputDirectory, "player-history.css");

const maximumBundleSize = 250 * 1024;

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
