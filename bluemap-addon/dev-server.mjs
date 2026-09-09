import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import browserSyncPackage from "browser-sync";
import { scriptOutput, styleOutput } from "./frontend-build.mjs";
import { playerHistoryAsset } from "./dev-options.mjs";

const contentTypes = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
};

export function createLocalAssetMiddleware() {
  return async (request, response, next) => {
    const pathname = new URL(request.url ?? "/", "http://development.local").pathname;
    const asset = playerHistoryAsset(pathname);
    if (!asset) {
      next();
      return;
    }

    const file = asset === "js" ? scriptOutput : styleOutput;
    try {
      const details = await stat(file);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": details.size,
        "Content-Type": contentTypes[asset],
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
