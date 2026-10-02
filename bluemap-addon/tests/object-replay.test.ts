import assert from "node:assert/strict";
import { test } from "vitest";
import {
  OBJECT_BREAK,
  OBJECT_OFFLINE,
  ObjectChunkCache,
  ObjectReplayEngine,
} from "../src/object-replay.js";
import type { ObjectHistoryPoint } from "../src/types.js";

const p = (
  time: number,
  x: number,
  qy = 0,
  qw = 32767,
  flags = 0,
  world = 0,
  geometry = 7,
): ObjectHistoryPoint => ({
  object: 1,
  time,
  world,
  x,
  y: 64 * 32,
  z: 0,
  qx: 0,
  qy,
  qz: 0,
  qw,
  sx: 1024,
  sy: 1024,
  sz: 1024,
  geometry,
  flags,
  groups: [],
});


test("object replay interpolates position and quaternion with slerp", () => {
  const engine = new ObjectReplayEngine(32, 32767, [
    p(100, 0, 0, 32767, OBJECT_BREAK),
    p(200, 32, 32767, 0),
  ]);

  const pose = engine.pose(1, 150);
  assert.ok(pose);
  assert.equal(pose.x, 0.5);
  assert.equal(pose.y, 64);
  assert.ok(Math.abs(pose.qy - Math.SQRT1_2) < 0.002);
  assert.ok(Math.abs(pose.qw - Math.SQRT1_2) < 0.002);
  assert.equal(pose.geometry, 7);
  assert.equal(pose.travel, 0.5);
});

test("object replay respects breaks, worlds, and explicit disappearance", () => {
  const engine = new ObjectReplayEngine(32, 32767, [
    p(100, 0, 0, 32767, OBJECT_BREAK),
    p(200, 3200, 0, 32767, OBJECT_BREAK, 1),
    p(300, 3200, 0, 32767, OBJECT_OFFLINE, 1),
  ]);

  assert.equal(engine.pose(1, 150)?.x, 0);
  assert.equal(engine.pose(1, 200)?.world, 1);
  assert.equal(engine.pose(1, 250)?.x, 100);
  assert.equal(engine.pose(1, 300), null);
});

test("object chunk cache treats an unpublished current chunk as a gap", async () => {
  let requests = 0;
  const cache = new ObjectChunkCache(
    "/objects",
    100,
    async (input) => {
      requests++;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify(
            String(input).endsWith("/100.json")
              ? [p(150, 32)]
              : [p(50, 0)],
          ),
      };
    },
    [[0, 200]],
  );

  const window = await cache.window(150);
  assert.ok(window.some((point) => point.time === 150));
  assert.equal(requests, 2);

  cache.setAvailableRanges([[0, 100]]);
  cache.clear();
  const missing = await cache.window(150);
  assert.deepEqual(missing, []);
});

test("poses can be filtered to the active dimension", () => {
  const engine = new ObjectReplayEngine(32, 32767, [
    p(100, 0, 0, 32767, OBJECT_BREAK, 0),
    { ...p(100, 0, 0, 32767, OBJECT_BREAK, 1), object: 2 },
  ]);

  assert.deepEqual(
    engine.poses(100, 1).map((pose) => pose.object),
    [2],
  );
});


test("historical object travel reverses with object-local movement", () => {
  const engine = new ObjectReplayEngine(32, 32767, [
    p(100, 0, 0, 32767, OBJECT_BREAK),
    p(200, 32),
    p(300, 0),
  ]);

  assert.equal(engine.pose(1, 200)?.travel, 1);
  assert.equal(engine.pose(1, 250)?.travel, 0.5);
  assert.equal(engine.pose(1, 300)?.travel, 0);
});
