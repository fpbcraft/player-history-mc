import assert from "node:assert/strict";
import { test } from "vitest";
import { OBJECT_BREAK } from "../src/object-replay.js";
import { ObjectReplaySession } from "../src/object-replay-session.js";
import type {
  ObjectHistoryManifest,
  ObjectHistoryPoint,
} from "../src/types.js";

const point = (time: number, x: number, world = 0): ObjectHistoryPoint => ({
  object: 1,
  time,
  world,
  x,
  y: 64 * 32,
  z: 0,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 32767,
  sx: 1024,
  sy: 1024,
  sz: 1024,
  geometry: 7,
  flags: OBJECT_BREAK,
});

const manifest = (duration = 100): ObjectHistoryManifest => ({
  protocolVersion: 2,
  earliestTimestamp: 0,
  latestTimestamp: 1_000,
  chunkDurationMs: duration,
  positionScale: 32,
  quaternionScale: 32767,
  scaleScale: 1024,
  geometryArchive: true,
  geometries: [],
  registry: {
    objects: [{ id: 1, provider: "test", sourceId: "one", label: "One" }],
    worlds: ["minecraft:overworld", "minecraft:the_nether"],
  },
});

test("object replay session owns loaded-window readiness and world mapping", async () => {
  const session = new ObjectReplaySession(
    "/objects",
    (_base, duration) => ({
      duration,
      setAvailableRanges() {},
      clear() {},
      async window() {
        return [point(150, 32)];
      },
    }),
  );
  session.configure(manifest());

  const pending = await session.window(150);
  assert.deepEqual(session.frame(150, "minecraft:overworld")?.poses, []);

  assert.equal(session.applyWindow(pending), true);
  const frame = session.frame(150, "minecraft:overworld");
  assert.ok(frame);
  assert.equal(frame.poses.length, 1);
  assert.equal(frame.poses[0]?.x, 1);
  assert.equal(frame.objects[0]?.label, "One");
});

test("object replay session suppresses poses for another or unknown world", async () => {
  const session = new ObjectReplaySession(
    "/objects",
    (_base, duration) => ({
      duration,
      setAvailableRanges() {},
      clear() {},
      async window() {
        return [point(150, 32, 1)];
      },
    }),
  );
  session.configure(manifest());
  const window = await session.window(150);
  session.applyWindow(window);

  assert.equal(session.frame(150, "minecraft:overworld")?.poses.length, 0);
  assert.equal(session.frame(150, "minecraft:the_nether")?.poses.length, 1);
  assert.equal(session.frame(150, "missing:world")?.poses.length, 0);
});

test("reset invalidates an in-flight object window", async () => {
  const session = new ObjectReplaySession(
    "/objects",
    (_base, duration) => ({
      duration,
      setAvailableRanges() {},
      clear() {},
      async window() {
        return [point(150, 32)];
      },
    }),
  );
  session.configure(manifest());

  const window = await session.window(150);
  session.resetWindow();

  assert.equal(session.applyWindow(window), false);
  assert.deepEqual(session.frame(150, "minecraft:overworld")?.poses, []);
});

test("removing the manifest clears object replay availability", () => {
  let clears = 0;
  const session = new ObjectReplaySession(
    "/objects",
    (_base, duration) => ({
      duration,
      setAvailableRanges() {},
      clear() {
        clears++;
      },
      async window() {
        return [];
      },
    }),
  );
  session.configure(manifest());
  session.configure(undefined);

  assert.equal(clears, 1);
  assert.equal(session.frame(150, "minecraft:overworld"), undefined);
});
