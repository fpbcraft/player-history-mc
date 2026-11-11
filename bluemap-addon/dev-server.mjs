import { createReadStream } from "node:fs";
import { resolve, sep } from "node:path";
import { stat } from "node:fs/promises";
import browserSyncPackage from "browser-sync";
import { playerHistoryAsset } from "./dev-options.mjs";
import { outputDirectory, scriptOutput, styleOutput } from "./frontend-build.mjs";

const contentTypes = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
};

export function createLocalAssetMiddleware() {
  return async (request, response, next) => {
    const pathname = new URL(request.url ?? "/", "http://development.local").pathname;
    const asset = playerHistoryAsset(pathname);
    const module = pathname.match(
      /\/player-history\/(modules\/[A-Za-z0-9.+_-]+\/(?:chunks\/)?[A-Za-z0-9_-]+\.js)$/,
    )?.[1];
    if (!asset && !module) {
      next();
      return;
    }

    const file = module
      ? resolve(outputDirectory, module)
      : asset === "js"
        ? scriptOutput
        : styleOutput;
    if (module && !file.startsWith(resolve(outputDirectory) + sep)) return next();
    try {
      const details = await stat(file);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": details.size,
        "Content-Type": contentTypes[module ? "js" : asset],
      });
      createReadStream(file).pipe(response);
    } catch (error) {
      next(error);
    }
  };
}

export async function startDevelopmentProxy(options) {
  const browserSync = browserSyncPackage.create("player-history");
  await new Promise((resolve, reject) => {
    browserSync.init(
      {
        proxy: options.target,
        host: options.host,
        port: options.port,
        open: options.open,
        ui: false,
        notify: false,
        ghostMode: false,
        injectChanges: false,
        middleware: createLocalAssetMiddleware(),
      },
      (error) => (error ? reject(error) : resolve()),
    );
  });
  return browserSync;
}
