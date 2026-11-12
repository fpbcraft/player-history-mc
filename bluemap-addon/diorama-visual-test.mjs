import { deflateSync } from "node:zlib";
import { vehicleFixture, whitePng } from "./vehicle-fixture.mjs";
import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = dirname(fileURLToPath(import.meta.url));
const mapRoot = resolve(
  process.env.DIORAMA_ROOT ?? join(root, "../../diorama"),
  "src/main/resources/diorama/web",
);
const output = join(root, "visual-output/diorama");
await mkdir(output, { recursive: true });
const started = Date.now();
const start = Math.floor((started - 600000) / 60000) * 60000;
const registry = {
  players: ["Ada", "NetherExplorer", "OfflineBuilder"].map((name, i) => ({
    id: i + 1,
    uuid: `00000000-0000-0000-0000-00000000000${i + 1}`,
    name,
  })),
  worlds: [
    { id: 0, key: "minecraft:overworld" },
    { id: 1, key: "minecraft:the_nether" },
  ],
  items: [],
};
const point = (time, player = 1) => ({
  player,
  time,
  world: player === 2 ? 1 : 0,
  x: Math.round((-32 + (time - start) / 15000) * 32),
  y: 64 * 32,
  z: Math.round(Math.sin((time - start) / 90000) * 16 * 32),
  flags: 0,
});
const offline = { ...point(start, 3), flags: 2 };
const events = [
  { point: point(start + 240000), type: "CHAT", payload: { message: "Fixture: station ready" } },
  { point: point(start + 300000), type: "DEATH", payload: {} },
];
const requests = [];
let terrainRevision = start;
let terrainHeight = 64;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  requests.push(url.pathname);
  const json = (value) => {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(value));
  };
  try {
    const path = url.pathname;
    if (path === "/diorama/map.json")
      return json({
        tileUnits: 128,
        tilePixels: 512,
        sin: Math.sin((40 * Math.PI) / 180),
        cos: Math.cos((40 * Math.PI) / 180),
        facing: 0,
        background: "#15171c",
        updated: terrainRevision,
        depth: true,
        dimensions: registry.worlds.map((world) => ({
          id: world.key,
          folder: world.id ? "nether" : "overworld",
          zoomLevels: 1,
          tiles: [[-1, -1, 0, -1, -1, 0, 0, 0]],
        })),
      });
    if (path === "/diorama/updates.json") return json({ updated: terrainRevision });
    if (path === "/fixture/terrain-height") {
      terrainHeight = Number(url.searchParams.get("y"));
      terrainRevision++;
      return json({ ok: true });
    }
    if (path === "/assets/bluemap3d/entities3d.json")
      return json({
        generatedAt: Date.now(),
        intervalMs: 500,
        objects: [
          {
            id: "train/fixture",
            label: "Synthetic Create train",
            dimension: "minecraft:overworld",
            mesh: "assets/bluemap3d/train.bm3d",
            pos: [-20 + Math.sin((Date.now() - started) / 3000) * 5, 68, 0],
            rot: [
              0,
              Math.sin((Date.now() - started) / 10000),
              0,
              Math.cos((Date.now() - started) / 10000),
            ],
          },
          {
            id: "sable/fixture",
            label: "Synthetic Sable ship",
            dimension: "minecraft:overworld",
            mesh: "assets/bluemap3d/train.bm3d",
            pos: [24, 90, 8],
            rot: [0, 0, 0, 1],
          },
        ],
      });
    if (path.endsWith(".bm3d")) {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      return res.end(Buffer.from(vehicleFixture()));
    }
    if (path.endsWith("white.png")) {
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(whitePng);
    }
    if (path.endsWith(".depth")) {
      const match = /(-?\d+)_(-?\d+)\.depth$/.exec(path),
        tileV = Number(match?.[2] ?? 0);
      const buffer = new ArrayBuffer(16 + 512 * 512 * 4),
        view = new DataView(buffer);
      view.setUint32(0, 0x44444550, false);
      view.setUint32(4, 2, true);
      view.setUint32(8, 512, true);
      view.setUint32(12, 512, true);
      const values = new Float32Array(buffer, 16),
        sin = Math.sin((40 * Math.PI) / 180),
        cos = Math.cos((40 * Math.PI) / 180);
      for (let y = 0; y < 512; y++) {
        const v = tileV * 128 + (y + 0.5) / 4;
        const depth = -(sin * terrainHeight + (cos * (v + terrainHeight * cos)) / sin);
        values.fill(depth, y * 512, (y + 1) * 512);
      }
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      return res.end(
        Buffer.concat([Buffer.from(buffer, 0, 16), deflateSync(Buffer.from(buffer, 16))]),
      );
    }
    if (path === "/player-history/data/objects/manifest.json")
      return json({
        protocolVersion: 3,
        earliestTimestamp: start,
        latestTimestamp: started,
        chunkDurationMs: 60000,
        positionScale: 32,
        quaternionScale: 32767,
        scaleScale: 1024,
        geometryArchive: true,
        registry: {
          objects: [
            {
              id: 1,
              provider: "create_contraptions",
              sourceId: "fixture-train",
              label: "Recorded train",
            },
          ],
          worlds: ["minecraft:overworld"],
        },
        geometries: [
          {
            provider: "create_contraptions",
            sourceId: "fixture-train",
            version: 1,
            mesh: "meshes/train.bm3d",
            atlas: "meshes/white.png",
            lastReferencedAt: started,
          },
        ],
      });
    if (path.includes("/data/objects/chunks/")) {
      const bucket = +path.split("/").at(-1).replace(".json", "");
      return json(
        Array.from({ length: 7 }, (_, i) => ({
          object: 1,
          time: bucket + i * 10000,
          world: 0,
          x: -20 * 32,
          y: 68 * 32,
          z: 0,
          qx: 0,
          qy: 0,
          qz: 0,
          qw: 32767,
          sx: 1024,
          sy: 1024,
          sz: 1024,
          geometry: 1,
          flags: 0,
          groups: [],
        })),
      );
    }
    if (path === "/diorama/extensions.json")
      return json({
        scripts: ["/player-history/diorama-history.js"],
        styles: ["/player-history/player-history.css"],
      });
    if (path.endsWith("/presence.json") || path.endsWith("/live.json")) {
      const now = Date.now();
      const points = path.endsWith("/presence.json")
        ? [point(now), point(now, 2)]
        : Array.from({ length: 31 }, (_, i) => point(now - (30 - i) * 1000)).concat(point(now, 2));
      return json({
        protocolVersion: 2,
        generatedAt: now,
        registry,
        points,
        events,
        states: { 1: { health: 18, maxHealth: 20, food: 17 } },
        lastLocations: [offline],
      });
    }
    if (path === "/player-history/data/manifest.json")
      return json({
        protocolVersion: 2,
        earliestTimestamp: start,
        latestTimestamp: started,
        chunkDurationMs: 60000,
        cellSize: 16,
        activityBucketMs: 60000,
        activityReady: true,
        capabilities: { movement: true, heatmap: true, health: true },
        registry,
      });
    if (path.includes("/data/chunks/")) {
      const bucket = +path.split("/").at(-1).replace(".json", "");
      const points = Array.from({ length: 7 }, (_, i) => point(bucket + i * 10000)).filter(
        (p) => p.time >= start && p.time <= started,
      );
      return json({
        points,
        events: events.filter((e) => e.point.time >= bucket && e.point.time < bucket + 60000),
      });
    }
    if (path.includes("/data/states/")) {
      const bucket = +path.split("/").at(-1).replace(".json", "");
      return json([
        {
          player: 1,
          time: bucket,
          kind: "checkpoint",
          values: { health: 18, maxHealth: 20, food: 17 },
        },
      ]);
    }
    if (path.includes("/activity/"))
      return json(Array.from({ length: 10 }, (_, i) => [start + i * 60000, 20]));
    if (path.includes("/heatmap/"))
      return json([
        [1, 0, -1, -1, 30000],
        [1, 0, 0, 0, 15000],
      ]);
    if (path === "/player-history/world-status.json")
      return json({
        version: 1,
        generatedAt: Date.now(),
        dimensions: { "minecraft:overworld": { dayTime: 6000 } },
      });
    if (path === "/player-history/server-overlays.json")
      return json({
        version: 2,
        generatedAt: Date.now(),
        dimensions: {
          "minecraft:overworld": {
            loaded: [{ x: -1, z: -1 }],
            pinned: [{ x: 0, z: 0 }],
            entities: [{ x: 0, z: 0, total: 18 }],
            claims: [{ x: -1, z: 0, color: 0x62bc83, owner: "Ada", forceLoadMarked: true }],
          },
        },
      });
    if (path === "/player-history-api/messages")
      return json({ messages: [{ name: "Ada", message: "Fixture: station ready" }] });
    if (path === "/player-history-api/session") return json({ linked: false });
    if (path === "/player-history-api/pair") return json({ token: "fixture-only", code: "ABC123" });
    if (path.endsWith(".jpg")) {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=3600" });
      return res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><pattern id="g" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="#739d7c" stroke-width="1"/></pattern></defs><path fill="#294334" d="M0 0h512v512H0z"/><path fill="url(#g)" d="M0 0h512v512H0z"/><text x="12" y="32" fill="#b5d1bc" font-family="sans-serif" font-size="16">Synthetic terrain fixture · 128 map units</text></svg>',
      );
    }
    let file;
    if (path === "/diorama/" || path === "/diorama/index.html") file = join(mapRoot, "index.html");
    else if (path === "/diorama/overlay-api.js") file = join(mapRoot, "overlay-api.js");
    else if (path.startsWith("/player-history/") && !path.includes(".."))
      file = join(root, "dist", path.slice("/player-history/".length));
    if (!file) throw Error("missing");
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type":
        { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[extname(file)] ??
        "application/octet-stream",
    });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), "diorama-visual-"));
const browser =
  process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(
  browser,
  [
    "--headless=new",
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.calls = new Map();
    this.runtimeErrors = [];
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Runtime.exceptionThrown") {
        this.runtimeErrors.push(message.params.exceptionDetails);
      }
      if (!message.id) return;
      const call = this.calls.get(message.id);
      if (!call) return;
      this.calls.delete(message.id);
      if (message.error) call.reject(new Error(message.error.message));
      else call.resolve(message.result);
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.calls.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}

let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try {
      port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
      break;
    } catch {
      await delay(100);
    }
  }
  if (!port) throw Error("Browser did not start");
  const target = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
  ).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  const cdp = new Cdp(socket);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  const wait = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (await cdp.evaluate(expression)) return;
      await delay(100);
    }
    throw Error(
      "Timed out: " +
        expression +
        "\n" +
        JSON.stringify({
          errors: cdp.runtimeErrors,
          state: await cdp.evaluate(
            `({text:document.body.innerText,api:!!window.diorama,state:window.diorama?.getState(),markers:[...document.querySelectorAll(".diorama-history-marker")].map(e=>({hidden:e.hidden,style:e.style.cssText,rect:e.getBoundingClientRect().toJSON()})),active:document.activeElement?.className})`,
          ),
          requests: requests.slice(-30),
        }),
    );
  };
  const capture = async (name) => {
    const result = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(output, `${name}.png`), Buffer.from(result.data, "base64"));
  };
  const orangePixels = async () => {
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    return cdp.evaluate(`(async()=>{const image=await createImageBitmap(await (await fetch("data:image/png;base64,${shot.data}")).blob());
      const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext("2d");context.drawImage(image,0,0);
      const data=context.getImageData(1000,660,460,220).data;let count=0;for(let i=0;i<data.length;i+=4)if(data[i]>220&&data[i+1]>160&&data[i+1]<220&&data[i+2]<180)count++;image.close();return count;})()`);
  };
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await cdp.send("Page.navigate", {
    url: `${origin}/diorama/#dim=minecraft%3Aoverworld&u=0&v=-49&s=2`,
  });
  await wait('document.querySelectorAll(".diorama-history-marker").length >= 2');
  assert.equal(await cdp.evaluate("window.diorama.getState().pixelRatio"), 2);
  const initial = await cdp.evaluate(
    'document.querySelector(".diorama-history-marker:not(.diorama-history-offline):not(.diorama-object-marker)").style.transform',
  );
  await wait("window.__fill().wanted > 0 && window.__fill().loaded === window.__fill().wanted");
  const tileRequests = requests.filter((path) => path.endsWith(".jpg")).length;
  await delay(2200);
  assert.notEqual(
    await cdp.evaluate(
      'document.querySelector(".diorama-history-marker:not(.diorama-history-offline):not(.diorama-object-marker)").style.transform',
    ),
    initial,
    "Live markers must move",
  );
  assert.equal(
    requests.filter((path) => path.endsWith(".jpg")).length,
    tileRequests,
    "Live overlays must not reload terrain",
  );
  await cdp.evaluate(
    'document.querySelector(".diorama-history-marker:not(.diorama-object-marker)").click()',
  );
  await wait('!document.querySelector(".diorama-history-tooltip").hidden');
  assert.equal(
    await cdp.evaluate(`document.querySelector('.heart.empty')?.getBoundingClientRect().width`),
    5,
    "Terrain empty-state CSS must not resize empty health hearts",
  );
  await wait(
    'Number(document.querySelector("canvas[data-vehicle-models]")?.dataset.vehicleModels) === 2',
  );
  await wait(
    'Number(document.querySelector("canvas[data-vehicle-models]")?.dataset.depthTiles) > 0',
  );
  await capture("desktop-live-tooltip");
  assert.ok((await orangePixels()) > 10, "Actual orange vehicle mesh pixels must be visible");
  await capture("desktop-live-vehicles");
  // Simulate a terrain revision without reloading the viewer or changing the vehicle model URL.
  const meshRequests = requests.filter((path) => path.endsWith(".bm3d")).length;
  await cdp.evaluate(`fetch('/fixture/terrain-height?y=200')`);
  await wait(
    `window.diorama.depthTiles().some(tile=>tile.url.includes("v="+String(${start + 1})))`,
  );
  let occluded = false;
  for (let i = 0; i < 30; i++) {
    if ((await orangePixels()) === 0) {
      occluded = true;
      break;
    }
    await delay(100);
  }
  assert.ok(occluded, "Nearer terrain depth must hide vehicle pixels");
  await capture("desktop-vehicles-occluded");
  assert.equal(
    requests.filter((path) => path.endsWith(".bm3d")).length,
    meshRequests,
    "Terrain revisions must not reload vehicle models",
  );
  await cdp.evaluate(`fetch('/fixture/terrain-height?y=64')`);
  await wait(
    `window.diorama.depthTiles().some(tile=>tile.url.includes("v="+String(${start + 2})))`,
  );

  await cdp.evaluate('document.querySelector("bluemap-player-replay").open()');
  await wait('Number(document.querySelector("[name=timeline]").max)>1');
  await cdp.evaluate(`document.querySelector("bluemap-player-replay").seek(${start + 270000})`);
  await wait('document.querySelectorAll(".diorama-history-event").length>0');
  await wait(
    'Number(document.querySelector("canvas[data-vehicle-models]")?.dataset.vehicleModels) === 1',
  );
  await capture("desktop-replay");
  const before = await cdp.evaluate("window.diorama.getState().scale");
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: 640,
    y: 300,
    deltaY: -200,
    deltaX: 0,
  });
  await delay(200);
  assert.ok((await cdp.evaluate("window.diorama.getState().scale")) > before);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: 600,
    y: 280,
    button: "left",
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 650,
    y: 310,
    button: "left",
    buttons: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: 650,
    y: 310,
    button: "left",
    clickCount: 1,
  });
  await cdp.evaluate(
    'document.querySelector("bluemap-player-replay").goNow(); document.querySelector(".history-player-followbar").click()',
  );
  await cdp.evaluate(
    `document.querySelector('.history-player-followbar button[data-dimension="minecraft:the_nether"]').click()`,
  );
  await wait('window.diorama.getState().dimension === "minecraft:the_nether"');
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await cdp.evaluate('document.querySelector("bluemap-player-replay").close()');
  await delay(200);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 180, y: 320 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 220, y: 350 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.evaluate('document.querySelector("bluemap-player-replay").open()');
  await delay(200);
  await capture("mobile-replay-controls");
  assert.equal(
    await cdp.evaluate("document.documentElement.scrollWidth <= innerWidth"),
    true,
    "No horizontal page overflow",
  );
  await cdp.evaluate("window.diorama.dispose()");
  assert.equal(await cdp.evaluate('document.querySelector("bluemap-player-replay")'), null);
  const polls = requests.filter(
    (path) => path.endsWith("presence.json") || path.endsWith("live.json"),
  ).length;
  await delay(1200);
  assert.equal(
    requests.filter((path) => path.endsWith("presence.json") || path.endsWith("live.json")).length,
    polls,
    "Dispose must stop polling",
  );
  assert.deepEqual(cdp.runtimeErrors, []);
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        liveMovement: true,
        liveVehicleMeshes: true,
        terrainDepth: true,
        historicalVehicleMeshes: true,
        revisionRefresh: true,
        overlayTileIsolation: true,
        historicalReplay: true,
        tooltips: true,
        dimensionFollow: true,
        panZoom: true,
        touch: true,
        highDpi: true,
        cleanup: true,
        fixture: true,
      },
      null,
      2,
    ),
  );
  console.log(`Diorama browser tests passed. Screenshots: ${output}`);
} finally {
  socket?.close();
  chrome.kill();
  server.closeAllConnections();
  server.close();
  await delay(250);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
