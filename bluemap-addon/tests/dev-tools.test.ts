import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { lanDevelopmentUrls, parseDevOptions, playerHistoryAsset } from "../dev-options.mjs";
import { startDevelopmentProxy } from "../dev-server.mjs";
import { scriptOutput, styleOutput } from "../frontend-build.mjs";

function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not expose a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function availablePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

describe("development options", () => {
  it("requires a valid HTTP target and applies defaults", () => {
    expect(parseDevOptions(["--target", "http://127.0.0.1:8100"])).toEqual({
      target: "http://127.0.0.1:8100/",
      host: "127.0.0.1",
      port: 3000,
      open: true,
    });
    expect(() => parseDevOptions([])).toThrow("--target is required");
    expect(() => parseDevOptions(["--target", "ftp://example.com"])).toThrow(
      "--target must use HTTP or HTTPS",
    );
  });

  it("accepts phone-hosting and no-open options", () => {
    expect(
      parseDevOptions([
        "--target=https://map.example.com/base/",
        "--host",
        "0.0.0.0",
        "--port=4173",
        "--no-open",
      ]),
    ).toEqual({
      target: "https://map.example.com/base/",
      host: "0.0.0.0",
      port: 4173,
      open: false,
    });
  });

  it("rejects unsupported and unsafe arguments", () => {
    expect(() => parseDevOptions(["--target", "https://user:pass@example.com"])).toThrow(
      "must not contain credentials",
    );
    expect(() => parseDevOptions(["--target", "https://example.com", "--port", "0"])).toThrow(
      "--port must be an integer",
    );
    expect(() => parseDevOptions(["--target", "https://example.com", "--wat"])).toThrow(
      "Unsupported argument",
    );
  });

  it("recognizes stable and versioned addon assets", () => {
    expect(playerHistoryAsset("/player-history/player-history.js")).toBe("js");
    expect(playerHistoryAsset("/player-history/player-history-0.8.13.js")).toBe("js");
    expect(playerHistoryAsset("/some/prefix/player-history-dev.css")).toBe("css");
    expect(playerHistoryAsset("/player-history/data/manifest.json")).toBeUndefined();
  });

  it("prints usable LAN addresses for phone testing", () => {
    expect(
      lanDevelopmentUrls(
        {
          lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
          en0: [{ address: "192.168.1.25", family: "IPv4", internal: false }],
        },
        "https:",
        3000,
      ),
    ).toEqual(["https://192.168.1.25:3000"]);
  });
});

describe("development proxy", () => {
  const servers: Server[] = [];
  const proxies: Array<{ exit: () => void }> = [];

  afterEach(async () => {
    for (const proxy of proxies.splice(0)) proxy.exit();
    await Promise.all(servers.splice(0).map(close));
  });

  it("proxies BlueMap traffic and replaces every addon asset version", async () => {
    const upstream = createServer((request, response) => {
      if (request.url === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end("<!doctype html><title>BlueMap fixture</title>");
        return;
      }
      if (request.url === "/maps/overworld/tiles.json") {
        response.setHeader("Content-Type", "application/json");
        response.end('{"map":"overworld"}');
        return;
      }
      if (request.url === "/player-history-api/send" && request.method === "POST") {
        response.setHeader("Content-Type", "application/json");
        response.end('{"ok":true}');
        return;
      }
      if (request.url === "/live/events") {
        response.setHeader("Content-Type", "text/event-stream");
        response.end("data: online\n\n");
        return;
      }
      response.statusCode = 404;
      response.end("upstream missing");
    });
    servers.push(upstream);
    const upstreamPort = await listen(upstream);
    const proxyPort = await availablePort();
    const proxy = await startDevelopmentProxy({
      target: `http://127.0.0.1:${upstreamPort}/`,
      host: "127.0.0.1",
      port: proxyPort,
      open: false,
    });
    proxies.push(proxy);

    const base = `http://127.0.0.1:${proxyPort}`;
    await expect(fetch(base).then((response) => response.text())).resolves.toContain(
      "BlueMap fixture",
    );
    await expect(
      fetch(`${base}/maps/overworld/tiles.json`).then((response) => response.json()),
    ).resolves.toEqual({ map: "overworld" });
    await expect(
      fetch(`${base}/player-history-api/send`, { method: "POST" }).then((response) =>
        response.json(),
      ),
    ).resolves.toEqual({ ok: true });
    await expect(fetch(`${base}/live/events`).then((response) => response.text())).resolves.toBe(
      "data: online\n\n",
    );

    const expectedScript = await readFile(scriptOutput, "utf8");
    const expectedStyle = await readFile(styleOutput, "utf8");
    for (const filename of [
      "player-history.js",
      "player-history-0.1.0.js",
      "player-history-dev.js",
    ]) {
      const response = await fetch(`${base}/player-history/${filename}?cache=old`);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe(expectedScript);
    }
    const styleResponse = await fetch(`${base}/player-history/player-history-99.0.0.css?cache=old`);
    expect(styleResponse.headers.get("cache-control")).toBe("no-store");
    expect(await styleResponse.text()).toBe(expectedStyle);
  }, 15_000);
});
