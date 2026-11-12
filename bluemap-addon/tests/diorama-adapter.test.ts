// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DioramaAdapter } from "../src/diorama-adapter.js";
import type { DioramaApi, DioramaOverlay } from "../src/diorama-api.js";
import { aggregateCorners, historyPosition } from "../src/diorama-geometry.js";
import { DioramaObjectAdapter } from "../src/diorama-object-adapter.js";
import type { HistoryPoint } from "../src/types.js";

const point: HistoryPoint = {
  player: 1,
  time: 1000,
  world: 0,
  x: -1024,
  y: 2048,
  z: -512,
  flags: 0,
};
const players = [{ id: 1, uuid: "00000000-0000-0000-0000-000000000001", name: "Ada" }];
let adapter: DioramaAdapter;
let dimension: string;
let api: DioramaApi;
let overlays: Map<string, DioramaOverlay>;
let remove: ReturnType<typeof vi.fn>;
beforeEach(() => {
  dimension = "minecraft:overworld";
  overlays = new Map();
  remove = vi.fn();
  api = {
    version: 1,
    events: new EventTarget(),
    getState: () => ({
      dimension,
      dimensions: [dimension],
      u: 0,
      v: 0,
      scale: 1,
      width: 800,
      height: 600,
      pixelRatio: 2,
      projection: { sin: 1, cos: 0, facing: 0 },
    }),
    screen: vi.fn((p) => ({ x: p.x + 400, y: p.z - p.y + 300 })),
    navigate: vi.fn(() => true),
    setDimension: vi.fn((id) => {
      dimension = id;
      return true;
    }),
    registerOverlay: (id, overlay) => {
      overlays.set(id, overlay);
      if (overlay.element) document.body.append(overlay.element);
      return { invalidate: vi.fn(), remove };
    },
  };
  adapter = new DioramaAdapter(api, new URL("http://localhost/player-history/"));
});
afterEach(() => {
  adapter.dispose();
  document.body.replaceChildren();
});

it("converts protocol units once, including negative and Y coordinates", () => {
  expect(historyPosition(point)).toEqual({ x: -32, y: 64, z: -16 });
  adapter.setPlayers([point], new Map([[1, "Ada"]]), players);
  expect(api.screen).toHaveBeenCalledWith({ x: -32, y: 64, z: -16 });
  const marker = document.querySelector<HTMLButtonElement>(".diorama-history-marker");
  expect(marker?.getAttribute("aria-label")).toContain("Ada");
  expect(marker?.style.transform).toContain("368px,220px");
  expect(marker?.querySelector("img")?.src).toContain("/player-history/skins/");
});

it("does not invent unknown players, removes hidden players, reuses surviving nodes", () => {
  adapter.setPlayers([point, { ...point, player: 99 }], new Map(), players);
  const marker = document.querySelector(".diorama-history-marker");
  expect(document.querySelectorAll(".diorama-history-marker")).toHaveLength(1);
  adapter.setPlayers([{ ...point, x: -2048 }], new Map(), players);
  expect(document.querySelector(".diorama-history-marker")).toBe(marker);
  adapter.setPlayers([], new Map(), players);
  expect(document.querySelectorAll(".diorama-history-marker")).toHaveLength(0);
});

it("keeps offline state distinct and hides old markers immediately on dimension change", () => {
  adapter.setOfflineLocations([{ point, name: "Ada", dimension, offline: true }]);
  const marker = document.querySelector<HTMLButtonElement>(".diorama-history-offline");
  expect(marker?.getAttribute("aria-label")).toContain("Offline");
  dimension = "minecraft:the_nether";
  api.events.dispatchEvent(new CustomEvent("change", { detail: { reason: "viewport" } }));
  expect(marker?.hidden).toBe(true);
  adapter.setOfflineLocations([]);
  expect(marker?.isConnected).toBe(false);
});

it("reuses event glyphs and positions, removes filtered events, exposes safe text details", () => {
  const event = { point, type: "CHAT", payload: { message: "<img onerror=alert(1)>" } };
  adapter.setEvents([event], new Map([[1, "Ada"]]));
  const marker = document.querySelector<HTMLButtonElement>(".diorama-history-event");
  marker?.click();
  expect(document.querySelector(".diorama-history-tooltip")?.textContent).toContain("<img onerror");
  expect(document.querySelector(".diorama-history-tooltip img")).toBeNull();
  adapter.setEvents([event], new Map());
  expect(document.querySelector(".diorama-history-event")).toBe(marker);
  adapter.setEvents([], new Map());
  expect(marker?.isConnected).toBe(false);
});

it("projects negative heatmap/chunk corners at the documented reference height", () => {
  aggregateCorners(api, -16, -32, 16, 64);
  expect(api.screen).toHaveBeenCalledWith({ x: -16, y: 64, z: -32 });
  expect(api.screen).toHaveBeenCalledWith({ x: 0, y: 64, z: -16 });
});

it("disposes overlays, roster, listeners and asynchronous tooltip results", async () => {
  let resolve: (text: string) => void = () => {};
  adapter.stateDetails = () =>
    new Promise((r) => {
      resolve = r;
    });
  adapter.setPlayers([point], new Map(), players);
  document.querySelector<HTMLButtonElement>(".diorama-history-marker")?.click();
  adapter.dispose();
  resolve("late private DOM update");
  await Promise.resolve();
  expect(remove).toHaveBeenCalled();
  expect(document.querySelector(".diorama-history-tooltip")).toBeNull();
  expect(document.querySelector(".history-roster-details")).toBeNull();
});

it("renders object poses in blocks without requesting meshes", () => {
  const objects = new DioramaObjectAdapter(api);
  objects.setObjects(
    [
      {
        object: 1,
        x: -32,
        y: 80,
        z: 48,
        time: 1000,
        world: 0,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        sx: 1,
        sy: 1,
        sz: 1,
        geometry: 0,
        groups: [],
        travel: 0,
      },
    ],
    [{ id: 1, provider: "create:train", sourceId: "train-1", label: "Express" }],
    [],
    "/unused/",
  );
  expect(document.querySelector(".diorama-object-marker")?.getAttribute("aria-label")).toContain(
    "Express",
  );
  expect(api.screen).toHaveBeenCalledWith(expect.objectContaining({ x: -32, y: 80, z: 48 }));
  objects.clear();
  expect(document.querySelector(".diorama-object-marker")).toBeNull();
  objects.dispose();
});

it("interpolates a trail hit in screen space, retaining height and timestamp", async () => {
  const { hitTrail } = await import("../src/diorama-geometry.js");
  const to = { ...point, x: point.x + 32 * 20, y: point.y + 32 * 10, time: 2000 };
  // Projection is x+400,z-y+300, so midpoint is (378,215).
  expect(hitTrail(api, [[point, to]], 378, 215)).toMatchObject({ x: -704, y: 2208, time: 1500 });
  expect(hitTrail(api, [[point, { ...to, flags: 1 }]], 378, 215)).toBeNull();
  expect(hitTrail(api, [[point, { ...to, world: 1 }]], 378, 215)).toBeNull();
});
