import { decodeCraftSprite } from "../src/craft-sprite-format.js";
import { craftSpriteFixture } from "../vehicle-fixture.mjs";
import { animateVehicle } from "../src/vehicle-resources.js";
import { signedVehicleTravel } from "../src/vehicle-travel.js";
import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import * as T from "three";
import {
  decodeVehicleMesh,
  decodeDepthTile,
  readDepthTile,
  parseVehicleFeed,
  publicAssetUrl,
} from "../src/vehicle-scene.js";
import { updateVehicleCamera } from "../src/diorama-camera.js";
import { vehicleFixture } from "../vehicle-fixture.mjs";

it("decodes geometry and rejects truncated or oversized meshes", () => {
  const bytes = vehicleFixture();
  expect(decodeVehicleMesh(bytes).positions).toHaveLength(24);
  expect(decodeVehicleMesh(bytes).indices).toHaveLength(36);
  expect(() => decodeVehicleMesh(bytes.slice(0, bytes.byteLength - 1))).toThrow();
  const invalid = bytes.slice(0);
  new DataView(invalid).setUint32(8, 500001, true);
  expect(() => decodeVehicleMesh(invalid)).toThrow();
});
it("refuses cross-origin, credentials, traversal and escaped public asset paths", () => {
  expect(
    publicAssetUrl("assets/bluemap3d/train.bm3d", "https://map.test/", ["/assets/bluemap3d/"]),
  ).toContain("train.bm3d");
  for (const path of [
    "https://other.test/assets/bluemap3d/a",
    "/private/registry.json",
    "/assets/bluemap3d/../../private/x",
    "/assets/bluemap3d/%2f..%2fprivate/x",
    "https://user:secret@map.test/assets/bluemap3d/a",
  ])
    expect(() => publicAssetUrl(path, "https://map.test/", ["/assets/bluemap3d/"])).toThrow();
});
it("bounds and validates poses, dimensions, duplicates and polling rates", () => {
  const row = {
    id: "ship/1",
    dimension: "mod:moon",
    mesh: "assets/bluemap3d/a.bm3d",
    pos: [-32, 64, 16],
    rot: [0, 0, 0, 1],
  };
  const parsed = parseVehicleFeed(
    { intervalMs: 1, objects: [row, row, { ...row, id: "bad", pos: [NaN, 0, 0] }] },
    "https://map.test/",
  );
  expect(parsed.interval).toBe(250);
  expect(parsed.objects).toHaveLength(1);
  expect(parsed.objects[0]?.dimension).toBe("mod:moon");
  expect(() => parseVehicleFeed({ objects: Array(2001).fill(row) }, "https://map.test/")).toThrow();
});
it("decodes depth including unknown pixels and rejects mismatched metadata", () => {
  const bytes = new ArrayBuffer(32),
    view = new DataView(bytes);
  view.setUint32(0, 0x44444550, false);
  view.setUint32(4, 1, true);
  view.setUint32(8, 2, true);
  view.setUint32(12, 2, true);
  new Float32Array(bytes, 16).set([-64, NaN, 20, 100]);
  expect(decodeDepthTile(bytes, 2)[0]).toBe(-64);
  expect(Number.isNaN(decodeDepthTile(bytes, 2)[1])).toBe(true);
  expect(() => decodeDepthTile(bytes, 512)).toThrow();
});
for (const facing of [0, 1, 2, 3])
  it(`aligns GPU and map projection for facing ${facing}`, () => {
    for (const pitch of [20, 40, 70]) {
      const sin = Math.sin((pitch * Math.PI) / 180),
        cos = Math.cos((pitch * Math.PI) / 180);
      const state = {
        dimension: "minecraft:overworld",
        dimensions: [],
        u: -190,
        v: 55,
        scale: 3,
        width: 800,
        height: 600,
        pixelRatio: 2,
        projection: { sin, cos, facing },
      };
      const camera = new T.OrthographicCamera(),
        origin = updateVehicleCamera(camera, state),
        point = new T.Vector3(-210, 86, -170),
        screen = point.clone().sub(origin).project(camera);
      const u = [point.x, point.z, -point.x, -point.z][facing] ?? 0,
        z = [point.z, -point.x, -point.z, point.x][facing] ?? 0;
      expect((screen.x + 1) * 400).toBeCloseTo((u - state.u) * 3 + 400, 6);
      expect((1 - screen.y) * 300).toBeCloseTo((z * sin - point.y * cos - state.v) * 3 + 300, 6);
    }
  });

it("reads compressed depth and bounds expanded payloads", async () => {
  const header = Buffer.alloc(16);
  header.write("DDEP");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(2, 8);
  header.writeUInt32LE(2, 12);
  const body = new Float32Array([-40, NaN, 20, 100]);
  const packed = (bytes: Uint8Array) =>
    Uint8Array.from(Buffer.concat([header, deflateSync(bytes)])).buffer;
  const result = await readDepthTile(packed(new Uint8Array(body.buffer)), 2);
  expect(result[0]).toBe(-40);
  expect(Number.isNaN(result[1])).toBe(true);
  await expect(readDepthTile(packed(new Uint8Array(100)), 2)).rejects.toThrow();
  await expect(readDepthTile(packed(new Uint8Array(4)), 2)).rejects.toThrow();
});

it("uses the same signed wheel travel for live and recorded motion", () => {
  expect(signedVehicleTravel(0, 0, 3, [0, 0, 0, 1])).toBe(3);
  expect(signedVehicleTravel(0, 0, -3, [0, 0, 0, 1])).toBe(-3);
  expect(signedVehicleTravel(-3, 0, 0, [0, 0, 0, 1])).toBe(-3);
  expect(signedVehicleTravel(0, 0, 3, [0, 1, 0, 0])).toBe(-3);
});

it("keeps mirrored axles in step and reverses travel-driven animation", () => {
  const root = new T.Group();
  const left = new T.Group(),
    right = new T.Group();
  root.add(new T.Group(), left, right);
  const parts = [1, -1].map((x) => ({
    kind: 0,
    start: 0,
    count: 3,
    pivot: [0, 0, 0] as [number, number, number],
    axis: [x, 0, 0] as [number, number, number],
    radius: 2,
    period: 0,
    rate: 0,
  }));
  animateVehicle(root, parts, 4, 0);
  expect(left.quaternion.angleTo(right.quaternion)).toBeCloseTo(0);
  const forward = left.quaternion.clone();
  animateVehicle(root, parts, -4, 0);
  expect(left.quaternion.angleTo(forward.clone().invert())).toBeCloseTo(0);
});

it("decodes shared craft depth and refuses invalid or oversized expansion", async () => {
  const bytes = Uint8Array.from(craftSpriteFixture()).buffer;
  const sprite = await decodeCraftSprite(bytes);
  expect(sprite.width).toBe(64);
  expect(sprite.height).toBe(24);
  expect(sprite.offsetU).toBe(-8);
  expect(sprite.depth).toHaveLength(64 * 24);
  const bad = bytes.slice(0);
  new DataView(bad).setUint32(8, 4096, true);
  await expect(decodeCraftSprite(bad)).rejects.toThrow();
  await expect(decodeCraftSprite(bytes.slice(0, 40))).rejects.toThrow();
});
it("resolves an independent publisher behind a map subpath", () => {
  const row = {
    id: "sable/1",
    dimension: "minecraft:overworld",
    mesh: "assets/diorama-vehicles/a.dspr",
    atlas: "assets/diorama-vehicles/a.png",
    pos: [0, 80, 0],
    rot: [0, 0, 0, 1],
  };
  const feed = parseVehicleFeed({ objects: [row] }, "https://map.test/diorama/");
  expect(feed.objects[0]?.mesh).toBe("https://map.test/diorama/assets/diorama-vehicles/a.dspr");
  expect(feed.objects[0]?.atlas).toBe("https://map.test/diorama/assets/diorama-vehicles/a.png");
});

it("preserves the craft camera and rejects invalid projection metadata", async () => {
  const original = Uint8Array.from(craftSpriteFixture());
  const bytes = new Uint8Array(original.length + 32);
  bytes.set(original.subarray(0, 32));
  bytes.set(original.subarray(32), 64);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 2, true);
  view.setFloat64(32, 0.6, true);
  view.setFloat64(40, 0.8, true);
  view.setUint32(48, 3, true);
  view.setUint32(52, 4, true);
  expect((await decodeCraftSprite(bytes.buffer)).projection).toEqual({
    sin: 0.6,
    cos: 0.8,
    facing: 3,
    pixelsPerUnit: 4,
  });
  view.setFloat64(32, 2, true);
  await expect(decodeCraftSprite(bytes.buffer)).rejects.toThrow();
});
