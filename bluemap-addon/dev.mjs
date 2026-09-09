import { access, rename, rm } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { formatMessages } from "esbuild";
import { lanDevelopmentUrls, parseDevOptions, usage } from "./dev-options.mjs";
import { startDevelopmentProxy } from "./dev-server.mjs";
import {
  copyStyles,
  createFrontendBuild,
  developmentScriptOutput,
  scriptOutput,
  verifyBundleSize,
  watchStyles,
} from "./frontend-build.mjs";

let options;
try {
  options = parseDevOptions(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`\n${usage}`);
  process.exitCode = 1;
}

if (options?.help) {
  console.log(usage);
} else if (options) {
  let proxy;
  let skipNextWatchReload = false;
  const build = await createFrontendBuild({
    outfile: developmentScriptOutput,
    async onResult(result) {
      if (result.errors.length > 0) {
        const diagnostics = await formatMessages(result.errors, { kind: "error", color: true });
        console.error(
          `TypeScript build failed; continuing with the last working bundle.\n${diagnostics.join("\n")}`,
        );
        return;
      }
      try {
        const size = await verifyBundleSize(developmentScriptOutput);
        await rename(developmentScriptOutput, scriptOutput);
        console.log(`Built player-history.js (${size} bytes)`);
        if (skipNextWatchReload) {
          skipNextWatchReload = false;
        } else {
          proxy?.reload();
        }
      } catch (error) {
        console.error("Frontend build failed; keeping the last working bundle:", error);
      }
    },
  });

  try {
    try {
      await build.rebuild();
    } catch (error) {
      try {
        await access(scriptOutput);
      } catch {
        throw error;
      }
    }
    await copyStyles();
    proxy = await startDevelopmentProxy(options);
    if (options.host === "0.0.0.0") {
      const protocol = new URL(options.target).protocol;
      const urls = lanDevelopmentUrls(networkInterfaces(), protocol, options.port);
      for (const url of urls) console.log(`Phone: ${url}`);
    }
    skipNextWatchReload = true;
    await build.watch();

    const styleWatcher = watchStyles({
      onSuccess: async () => {
        console.log("Updated player-history.css");
        proxy.reload();
      },
      onError: (error) =>
        console.error("Stylesheet build failed; keeping the last working file:", error),
    });

    const close = async () => {
      styleWatcher.close();
      proxy.exit();
      await build.dispose();
      await rm(developmentScriptOutput, { force: true });
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  } catch (error) {
    await build.dispose();
    await rm(developmentScriptOutput, { force: true });
    throw error;
  }
}
