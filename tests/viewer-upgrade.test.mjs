import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
const root = new URL("../", import.meta.url);
test("built viewer imports only immutable same-release module paths", async () => {
  execFileSync(process.execPath, ["build.mjs"], {
    cwd: new URL("bluemap-addon/", root),
  });
  const { version } = JSON.parse(
    await readFile(new URL("bluemap-addon/package.json", root), "utf8"),
  );
  for (const name of ["player-history", "bluemap-adapter"]) {
    const source = await readFile(
      new URL(`bluemap-addon/dist/${name}-${version}.js`, root),
      "utf8",
    );
    for (const match of source.matchAll(
      /(?:replay-core|replay-state|bluemap-adapter|telemetry)[\w.-]*\.js(?:\?v=[\d.]+)?/g,
    )) {
      assert.ok(match[0].endsWith(`-${version}.js`), match[0]);
      await readFile(new URL("bluemap-addon/dist/" + match[0], root));
    }
  }
  const state = await import(
    new URL(`bluemap-addon/dist/replay-state-${version}.js`, root)
  );
  assert.equal(typeof state.visibleEvents, "function");
  assert.equal(typeof new state.ReplayClock().togglePlayback, "function");
});
test("pending mapping/cache initialization cannot stop the animation loop", async () => {
  const source = await readFile(
    new URL("bluemap-addon/src/player-history.js", root),
    "utf8",
  );
  let frames = 0;
  const Panel = vm.runInNewContext(
    source.slice(
      source.indexOf("  class ReplayPanel"),
      source.indexOf("  customElements.define"),
    ) + ";ReplayPanel",
    { HTMLElement: class {}, requestAnimationFrame: () => ++frames },
  );
  const panel = Object.create(Panel.prototype);
  Object.assign(panel, {
    opened: true,
    manifest: {},
    adapter: {},
    clock: { time: 1 },
    render: () => assert.fail("rendered before cache initialization"),
  });
  assert.doesNotThrow(() => panel.updateOverlays());
  assert.doesNotThrow(() => panel.animate(100));
  assert.equal(frames, 1);
  panel.cache = { duration: 300000 };
  panel.clock.rate = 0;
  panel.render = () => {
    throw Error("render failure");
  };
  assert.throws(() => panel.animate(200), /render failure/);
  assert.equal(frames, 2, "next frame scheduled before rendering failure");
});
test("closing the players menu leaves the speed picker open", async () => {
  const source = await readFile(new URL("bluemap-addon/src/player-history.js", root), "utf8");
  const Panel = vm.runInNewContext(source.slice(source.indexOf("  class ReplayPanel"), source.indexOf("  customElements.define")) + ";ReplayPanel", { HTMLElement: class {} });
  const speed = { hidden: false }, players = { hidden: false };
  const panel = Object.create(Panel.prototype);
  panel.querySelector = (selector) => selector === "#history-players" ? players : speed;
  panel.q = () => ({ setAttribute() {} });
  panel.showMenu = (menu, trigger, open) => { menu.hidden = !open; };
  panel.togglePlayers(false);
  assert.equal(players.hidden, true);
  assert.equal(speed.hidden, false);
  panel.togglePlayers();
  assert.equal(players.hidden, false);
});
