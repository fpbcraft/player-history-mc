import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

const root = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(root, "visual-dist");
const outputRoot = join(root, "visual-output");
const host = "127.0.0.1";
const port = 8100;
const debugPort = 9222;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const relative = normalize(requested).replace(/^[/\\]+/, "");
    const file = join(fixtureRoot, relative);
    if (!file.startsWith(fixtureRoot)) throw new Error("Invalid fixture path");
    const body = await readFile(file);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
await new Promise((resolve) => server.listen(port, host, resolve));

const browserCandidates = [
  process.env.CHROME_BIN,
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
].filter(Boolean);

const browser = browserCandidates.find(
  (candidate) => spawnSync("which", [candidate], { stdio: "ignore" }).status === 0,
);
if (!browser) {
  server.close();
  throw new Error("Chrome/Chromium not found. Set CHROME_BIN to a Chromium-compatible browser.");
}

const profile = await mkdtemp(join(tmpdir(), "player-history-visual-"));
let chromeDiagnostics = "";
const chrome = spawn(
  browser,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--hide-scrollbars",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
chrome.stderr.setEncoding("utf8");
chrome.stderr.on("data", (chunk) => {
  chromeDiagnostics += chunk;
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForDebugger() {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (chrome.exitCode !== null) {
      throw new Error(
        `Chrome exited before opening the debugger (code ${chrome.exitCode}).\n${chromeDiagnostics}`,
      );
    }
    try {
      const response = await fetch(`http://${host}:${debugPort}/json/version`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Chrome debugger did not start: ${String(lastError ?? "unknown error")}\n${chromeDiagnostics}`,
  );
}

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

async function waitForFixture(cdp) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const ready = await cdp.evaluate(
        'document.documentElement?.dataset.visualReady === "true"',
      );
      if (ready) return;
    } catch {
      // The execution context can disappear briefly while navigation commits.
    }
    await delay(50);
  }
  throw new Error("Visual fixture did not become ready");
}

async function capture({ name, scenario, width, height }) {
  const pageUrl = `http://${host}:${port}/?scenario=${encodeURIComponent(scenario)}`;
  const targetResponse = await fetch(
    `http://${host}:${debugPort}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  );
  if (!targetResponse.ok) throw new Error(`Could not create Chrome target: ${targetResponse.status}`);
  const target = await targetResponse.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const cdp = new Cdp(socket);
  try {
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 600,
    });
    await cdp.send("Page.navigate", { url: pageUrl });
    await waitForFixture(cdp);
    await delay(100);

    const expectedOverlay = {
      players: "#history-players",
      range: ".history-range-popover",
      chat: "#history-chat-panel",
    }[scenario];
    const state = await cdp.evaluate(`(()=>{
      const panel=document.querySelector("bluemap-player-replay > section");
      const rect=panel.getBoundingClientRect();
      const overlay=${JSON.stringify(expectedOverlay)} ? document.querySelector(${JSON.stringify(expectedOverlay)}) : null;
      const controlBar=document.querySelector(".control-bar");
      const position=document.querySelector(".control-bar .pos-input");
      const sync=document.querySelector(".player-history-game-time-sync");
      const follow=document.querySelector(".history-player-followbar");
      const controlRect=controlBar?.getBoundingClientRect();
      const followRect=follow?.getBoundingClientRect();
      const visible=(element)=>!!element && getComputedStyle(element).display !== "none";
      return {
        ready: document.documentElement.dataset.visualReady === "true",
        panelVisible: !panel.hidden && rect.width > 0 && rect.height > 0,
        panelInsideViewport: rect.left >= -1 && rect.right <= innerWidth + 1,
        overlayVisible: !overlay || (!overlay.hidden && getComputedStyle(overlay).display !== "none"),
        players: document.querySelector('[data-control="player-count"]')?.textContent,
        status: document.querySelector(".history-status")?.textContent,
        mobileControlsOk: innerWidth > 600 || (
          visible(position) &&
          visible(sync) &&
          sync.querySelector(".time-sync-label")?.textContent === "Sync" &&
          sync.querySelector("input[type=checkbox]")?.checked === true &&
          visible(follow) &&
          followRect?.width > 0 &&
          followRect?.top >= (controlRect?.bottom ?? 0) - 1
        ),
      };
    })()`);
    if (
      !state.ready ||
      !state.panelVisible ||
      !state.panelInsideViewport ||
      !state.overlayVisible ||
      !state.mobileControlsOk
    ) {
      throw new Error(`Visual fixture layout check failed: ${JSON.stringify(state)}`);
    }
    if (state.players !== "3") throw new Error(`Expected three fixture players: ${JSON.stringify(state)}`);
    if (cdp.runtimeErrors.length) {
      throw new Error(`Browser exception: ${JSON.stringify(cdp.runtimeErrors[0])}`);
    }

    const screenshot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(join(outputRoot, `${name}.png`), Buffer.from(screenshot.data, "base64"));
    return { name, scenario, width, height, state };
  } finally {
    socket.close();
    await fetch(`http://${host}:${debugPort}/json/close/${target.id}`);
  }
}

try {
  await waitForDebugger();
  const results = [];
  for (const scenario of [
    { name: "desktop", scenario: "default", width: 1280, height: 800 },
    { name: "players-popover", scenario: "players", width: 1280, height: 800 },
    { name: "range-popover", scenario: "range", width: 1280, height: 800 },
    { name: "chat-panel", scenario: "chat", width: 1280, height: 800 },
    { name: "mobile", scenario: "default", width: 390, height: 844 },
  ]) {
    results.push(await capture(scenario));
  }
  await writeFile(
    join(outputRoot, "report.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
  );
  console.log(`Visual verification passed (${results.length} screenshots)`);
} finally {
  chrome.kill("SIGTERM");
  await Promise.race([
    once(chrome, "exit"),
    delay(2_000).then(() => {
      chrome.kill("SIGKILL");
    }),
  ]);
  await new Promise((resolve) => server.close(resolve));
  if (chromeDiagnostics) {
    await writeFile(join(outputRoot, "chrome.log"), chromeDiagnostics);
  }
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
