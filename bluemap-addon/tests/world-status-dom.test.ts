/** @vitest-environment jsdom */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { WorldStatusController } from "../src/world-status.js";

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <div id="app">
      <div class="control-bar">
        <div class="pos-input"></div>
      </div>
    </div>
  `;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test("time sync uses a native labeled checkbox and changes controller state", () => {
  const saved: boolean[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.includes("integration.json")
            ? { mapWorlds: { world: "minecraft:overworld" } }
            : {
                version: 1,
                generatedAt: Date.now(),
                dimensions: {
                  "minecraft:overworld": {
                    dayTime: 18_000,
                    daylightCycle: true,
                    hasSkyLight: true,
                  },
                },
              },
      };
    }),
  );

  const sunlight = { value: 0.25 };
  const app = {
    mapViewer: {
      map: { data: { id: "world", skyLight: 1 } },
      data: { uniforms: { sunlightStrength: sunlight } },
      redraw: vi.fn(),
    },
    settings: { useCookies: true },
    loadUserSetting: () => true,
    saveUserSetting: (_key: string, value: boolean) => saved.push(value),
    events: { addEventListener: vi.fn() },
    appState: { menu: { currentPage: () => ({ id: "map" }) } },
  };

  new WorldStatusController(app);

  const control = document.querySelector<HTMLElement>(".player-history-game-time-sync");
  const input = control?.querySelector<HTMLInputElement>("input[type='checkbox']");
  const label = control?.querySelector<HTMLElement>(".time-sync-label");

  assert.ok(control);
  assert.ok(input);
  assert.equal(label?.textContent, "Sync");
  assert.equal(input.checked, true);
  assert.equal(control.dataset.state, "on");

  input.click();
  assert.equal(input.checked, false);
  assert.equal(control.dataset.state, "off");
  assert.deepEqual(saved, [false]);
  assert.equal(sunlight.value, 1);

  input.click();
  assert.equal(input.checked, true);
  assert.equal(control.dataset.state, "on");
  assert.deepEqual(saved, [false, true]);
});
