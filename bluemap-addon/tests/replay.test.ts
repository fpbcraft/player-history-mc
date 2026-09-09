import assert from "node:assert/strict";
import { test } from "vitest";
import { ChunkCache, heatmapPlan, mergePoints, ReplayEngine } from "../src/replay-core.js";

const p = (time, x, flags = 0, world = 0) => ({
  player: 1,
  time,
  x,
  y: 0,
  z: 0,
  flags,
  world,
});
test("sessions and interpolation respect all discontinuities", () => {
  const engine = new ReplayEngine([
    p(100, 0, 1),
    p(200, 32),
    p(300, 32, 2),
    p(400, 3200, 1),
    p(500, 0, 1, 1),
  ]);
  assert.equal(engine.position(1, 99), null);
  assert.equal(engine.position(1, 150).x, 16);
  assert.equal(engine.position(1, 200).x, 32);
  assert.equal(engine.position(1, 300), null);
  assert.equal(engine.position(1, 350), null);
  assert.equal(engine.position(1, 400).x, 3200);
  assert.equal(engine.position(1, 450).x, 3200);
  assert.equal(engine.position(1, 500).world, 1);
  assert.equal(engine.trails(1, 0, 600).length, 1);
});
test("mid-history context and stop anchors prevent idle drift", () => {
  const e = new ReplayEngine(
    mergePoints([
      {
        points: [p(0, 0, 9), p(500, 32), p(1000, 32, 4), p(30000, 32, 4), p(30500, 64)],
      },
    ]),
  );
  assert.equal(e.position(1, 20000).x, 32);
  assert.equal(e.position(1, 30250).x, 48);
});
test("context cannot resurrect an offline point at chunk boundary", () => {
  const e = new ReplayEngine(
    mergePoints([{ points: [p(100, 32), p(100, 32, 2)] }, { points: [p(100, 32, 8)] }]),
  );
  assert.equal(e.position(1, 100), null);
});
test("cache stays bounded and missing chunks are gaps", async () => {
  const cache = new ChunkCache("/data", 300000, async () => ({
    ok: true,
    text: async () => JSON.stringify({ points: [], events: [] }),
  }));
  for (let i = 0; i < 10; i++) await cache.window(i * 300000);
  assert.equal(cache.cache.size, 3);
});
test("aggregate plan uses daily data and only edge fine data", () => {
  const plan = heatmapPlan(0, 90 * 86400000, 300000);
  assert.equal(plan.length, 90);
  assert.ok(plan.every((p) => p.level === "day"));
});
test("a missing current chunk does not extend prior online presence", async () => {
  const cache = new ChunkCache("/data", 300000, async (url) =>
    url.endsWith("/300000.json")
      ? { status: 404 }
      : {
          ok: true,
          text: async () => JSON.stringify({ points: [p(100, 32)], events: [] }),
        },
  );
  const data = await cache.window(400000);
  assert.deepEqual(data.points, []);
});
test("trail endpoints clip to selected time without joining a teleport", () => {
  const e = new ReplayEngine([p(0, 0), p(100, 100), p(200, 500, 1), p(300, 600)]);
  const lines = e.trails(1, 50, 250);
  assert.equal(lines.length, 2);
  assert.equal(lines[0][0].x, 50);
  assert.equal(lines[1].at(-1).x, 550);
});
