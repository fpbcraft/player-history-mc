// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { DioramaCraftSprites } from "../src/diorama-craft-sprites.js";
import { loadCraftSprite, releaseCraftSprite } from "../src/craft-sprite-resource.js";
import type { DioramaApi, DioramaViewport } from "../src/diorama-api.js";
import type { VehiclePose } from "../src/vehicle-scene.js";
vi.mock("../src/craft-sprite-resource.js", async () => {
  const T = await import("three");
  return {
    loadCraftSprite: vi.fn(async (_url, _atlas, key) => {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(12), 3));
      return {
        key,
        sprite: { width: 16, height: 16, offsetU: 0, offsetV: 0 },
        mesh: new T.Mesh(
          geometry,
          new T.ShaderMaterial({
            uniforms: { picture: { value: null }, near: { value: null }, anchor: { value: 0 } },
          }),
        ),
        color: new T.Texture(),
        depth: new T.Texture(),
        image: { close: vi.fn() },
      };
    }),
    releaseCraftSprite: vi.fn(),
  };
});
it("retains immutable craft resources across empty seek windows", async () => {
  const api = { screen: () => ({ x: 100, y: 100 }) } as unknown as DioramaApi;
  const state = {
    u: 0,
    v: 0,
    scale: 2,
    width: 400,
    height: 400,
    pixelRatio: 1,
    dimension: "minecraft:overworld",
    dimensions: [],
    projection: { facing: 0, sin: 0.766044, cos: 0.642788 },
  } satisfies DioramaViewport;
  const row = {
    id: "history:1",
    label: "Ship",
    dimension: state.dimension,
    mesh: "https://example.test/ship.dspr",
    atlas: "https://example.test/ship.png",
    pos: [0, 64, 0],
    rot: [0, 0, 0, 1],
    scale: [1, 1, 1],
  } satisfies VehiclePose;
  const sprites = new DioramaCraftSprites(api);
  sprites.update([row], new Map(), 1, state);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sprites.update([row], new Map(), 1, state)).toEqual([row.id]);
  sprites.update([], new Map(), 1, state);
  expect(sprites.update([row], new Map(), 1, state)).toEqual([row.id]);
  expect(loadCraftSprite).toHaveBeenCalledTimes(1);
  expect(releaseCraftSprite).not.toHaveBeenCalled();
  sprites.dispose();
  expect(releaseCraftSprite).toHaveBeenCalledTimes(1);
});
