// @vitest-environment jsdom
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "vitest";

const addon = process.cwd();

test("build emits a self-contained stable viewer bundle", async () => {
  execFileSync(process.execPath, ["build.mjs"], { cwd: addon });
  const source = await readFile(resolve(addon, "dist/player-history.js"), "utf8");
  const styles = await readFile(resolve(addon, "dist/player-history.css"), "utf8");
  assert.match(source, /bluemap-player-replay/);
  assert.doesNotMatch(source, /\bimport\s*\(/);
  assert.doesNotMatch(source, /from\s+["']/);
  assert.ok(source.length < 250 * 1024);
  assert.match(styles, /bluemap-player-replay/);
});

test("panel methods tolerate initialization gaps", async () => {
  const { ReplayPanel } = await import("../src/replay-panel.js");
  const panel = Object.create(ReplayPanel.prototype) as ReplayPanel & Record<string, unknown>;
  Object.assign(panel, {
    adapter: undefined,
    cache: undefined,
    manifest: undefined,
    clock: { time: 1 },
  });
  assert.doesNotThrow(() => panel.updateOverlays());
});

test("closing the players menu does not close other popovers", async () => {
  const { ReplayPanel } = await import("../src/replay-panel.js");
  const panel = Object.create(ReplayPanel.prototype) as ReplayPanel;
  const host = document.createElement("div");
  Object.defineProperty(panel, "querySelector", { value: host.querySelector.bind(host) });
  host.innerHTML = '<div id="history-players" hidden></div><button name="players"></button>';
  const speed = document.createElement("div");
  speed.className = "history-speed-popover";
  speed.hidden = false;
  host.append(speed);
  panel.togglePlayers(false);
  assert.equal(panel.querySelector<HTMLElement>("#history-players")?.hidden, true);
  assert.equal(speed.hidden, false);
});
