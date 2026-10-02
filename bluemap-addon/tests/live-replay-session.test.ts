import assert from "node:assert/strict";
import { test } from "vitest";
import { LiveReplaySession } from "../src/live-replay-session.js";
import type { HistoryPoint } from "../src/types.js";

const point = (time: number, x: number, flags = 0, world = 0): HistoryPoint => ({
  player: 1,
  time,
  world,
  x,
  y: 0,
  z: 0,
  flags,
});

test("live replay interpolates one feed interval behind the newest snapshot", () => {
  const replay = new LiveReplaySession(1_000);
  replay.update([point(9_000, 0), point(10_000, 320)], 10_000, 1_000);

  assert.equal(replay.playbackTime(1_000), 9_000);
  assert.equal(replay.positions([1], 0, 1_500)[0]?.x, 160);
  assert.equal(replay.positions([1], 0, 2_000)[0]?.x, 320);
  assert.equal(replay.positions([1], 0, 2_500)[0]?.x, 320);
});

test("a new live snapshot continues from the prior rendered position without jumping", () => {
  const replay = new LiveReplaySession(1_000);
  replay.update([point(9_000, 0), point(10_000, 320)], 10_000, 1_000);

  assert.equal(replay.positions([1], 0, 2_000)[0]?.x, 320);

  replay.update(
    [point(9_000, 0), point(10_000, 320), point(11_000, 640)],
    11_000,
    2_000,
  );

  assert.equal(replay.positions([1], 0, 2_000)[0]?.x, 320);
  assert.equal(replay.positions([1], 0, 2_500)[0]?.x, 480);
});

test("duplicate live snapshots do not rewind interpolation", () => {
  const replay = new LiveReplaySession(1_000);
  const points = [point(9_000, 0), point(10_000, 320)];
  replay.update(points, 10_000, 1_000);

  assert.equal(replay.positions([1], 0, 1_500)[0]?.x, 160);
  replay.update(points, 10_000, 1_500);
  assert.equal(replay.positions([1], 0, 1_500)[0]?.x, 160);
});

test("a first live sample stays visible while the interpolation buffer fills", () => {
  const replay = new LiveReplaySession(1_000);
  replay.update([point(10_000, 320)], 10_000, 1_000);

  const position = replay.positions([1], 0, 1_000)[0];
  assert.equal(position?.x, 320);
  assert.equal(position?.time, 10_000);
});

test("offline first samples are not resurrected by the live fallback", () => {
  const replay = new LiveReplaySession(1_000);
  replay.update([point(10_000, 320, 2)], 10_000, 1_000);

  assert.deepEqual(replay.positions([1], 0, 1_000), []);
});

test("live replay still respects player selection and map dimension", () => {
  const replay = new LiveReplaySession(1_000);
  replay.update([point(9_000, 0), point(10_000, 320)], 10_000, 1_000);

  assert.deepEqual(replay.positions([2], 0, 1_500), []);
  assert.deepEqual(replay.positions([1], 1, 1_500), []);
});
