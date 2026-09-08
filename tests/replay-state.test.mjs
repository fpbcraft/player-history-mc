import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ReplayClock,
  HISTORY_WINDOW,
  shuttleRate,
} from "../bluemap-addon/src/replay-state.js";
import { ChunkCache } from "../bluemap-addon/src/replay-core.js";

test("selected speed controls playback and survives shuttle release, including pause", () => {
  const clock = new ReplayClock();
  clock.refresh(0, 100000);
  clock.seek(50000);
  clock.playbackRate = 8;
  clock.isPlaying = true;
  clock.tick(1000);
  assert.equal(clock.time, 58000);
  clock.shuttle(-0.5);
  clock.tick(1000);
  assert.equal(clock.time, 54000);
  clock.release();
  assert.equal(clock.rate, 8);
  clock.isPlaying = false;
  clock.shuttle(1);
  clock.release();
  assert.equal(clock.rate, 0);
  assert.equal(clock.playbackRate, 8);
});

test("day, week, custom and all ranges clamp to availability and preserve historical time", () => {
  const day = 86400000,
    clock = new ReplayClock();
  clock.refresh(day, 100 * day);
  for (const duration of [day, 7 * day, 14 * day, Infinity]) {
    clock.rangeDuration = duration;
    clock.refresh(day, 100 * day);
    assert.equal(clock.from, Math.max(day, 100 * day - duration));
  }
  clock.seek(20 * day);
  clock.refresh(2 * day, 101 * day);
  assert.equal(clock.from, 2 * day);
  assert.equal(clock.time, 20 * day);
  clock.rangeDuration = day;
  clock.refresh(2 * day, 101 * day);
  assert.equal(clock.time, 100 * day);
});

test("opening preserves the complete rolling range including empty periods", () => {
  const clock = new ReplayClock();
  clock.refresh(100, 1000);
  assert.equal(clock.from, 1000 - HISTORY_WINDOW);
  assert.equal(clock.time, 1000);
  clock.refresh(100, HISTORY_WINDOW * 2, true);
  assert.equal(clock.from, HISTORY_WINDOW);
  assert.equal(clock.time, HISTORY_WINDOW * 2);
  clock.refresh(500, 500, true);
  clock.seek(0);
  assert.equal(clock.time, 0);
  clock.seek(1000);
  assert.equal(clock.time, 500);
});
test("manifest refresh follows latest but preserves historical absolute time until trimmed", () => {
  const clock = new ReplayClock();
  clock.refresh(100, 10000);
  clock.refresh(100, 20000);
  assert.equal(clock.time, 20000);
  clock.seek(1000);
  clock.refresh(100, 30000);
  assert.equal(clock.time, 1000);
  clock.refresh(100, HISTORY_WINDOW + 2000);
  assert.equal(clock.time, 2000);
});
test("elastic shuttle reverses while paused and restores the separate normal state", () => {
  const clock = new ReplayClock();
  clock.refresh(0, 100000);
  clock.shuttle(-0.5);
  clock.tick(1000);
  assert.equal(clock.time, 96000);
  clock.release();
  assert.equal(clock.rate, 0);
  assert.equal(clock.shuttleRate, 1);
  clock.isPlaying = true;
  clock.shuttle(0.5);
  clock.tick(100);
  assert.equal(clock.time, 96400);
  clock.release();
  assert.equal(clock.rate, 1);
  clock.tick(100);
  assert.equal(clock.time, 96500);
});
test("rewind and forward clamp without wrapping or losing the shuttle's base state", () => {
  const clock = new ReplayClock();
  clock.customRange = { from: 100, to: 1000 };
  clock.refresh(100, 1000);
  clock.isPlaying = true;
  clock.shuttle(-1);
  clock.tick(1000);
  assert.equal(clock.time, 100);
  clock.shuttle(1);
  clock.tick(1000);
  assert.equal(clock.time, 1000);
  assert.equal(clock.isPlaying, true);
  clock.release();
  assert.equal(clock.rate, 1);
  clock.tick(1000);
  assert.equal(clock.isPlaying, false);
});
test("shuttle curve has precise slow, stopped, reverse and forward positions", () => {
  for (const [position, rate] of [
    [-1, -120],
    [-0.85, -60],
    [-0.7, -16],
    [-0.5, -4],
    [-0.35, -2],
    [-0.25, -1],
    [-0.16, 0],
    [-0.1, 0.5],
    [0, 1],
    [0.25, 2],
    [0.5, 4],
    [0.7, 16],
    [0.85, 60],
    [1, 120],
  ])
    assert.ok(Math.abs(shuttleRate(position) - rate) < 1e-10);
  assert.equal(shuttleRate(-2), -120);
  assert.equal(shuttleRate(2), 120);
});
test("refresh invalidates cached misses and mutable latest chunks", async () => {
  let published = false,
    requests = 0;
  const cache = new ChunkCache("/data", 100, async () => {
    requests++;
    return published
      ? {
          ok: true,
          text: async () =>
            JSON.stringify({ points: [{ time: 10, player: 1 }], events: [] }),
        }
      : { status: 404 };
  });
  await cache.window(10);
  await cache.window(10);
  assert.equal(requests, 3);
  published = true;
  cache.clear();
  assert.equal((await cache.window(10)).points.length, 1);
  assert.equal(requests, 6);
});
test("a cleared in-flight window cannot repopulate cache or publish stale data", async () => {
  const pending = [];
  const cache = new ChunkCache(
    "/data",
    100,
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const request = cache.window(10);
  cache.clear();
  pending.forEach((resolve) =>
    resolve({ ok: true, text: async () => '{"points":[],"events":[]}' }),
  );
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(cache.cache.size, 0);
});

test("custom dates stay fixed even outside retained data", () => {
  const clock = new ReplayClock();
  clock.customRange = { from: 2000, to: 5000 };
  clock.refresh(1000, 10000, true);
  assert.equal(clock.from, 2000);
  assert.equal(clock.to, 5000);
  assert.equal(clock.time, 5000);
  clock.seek(3000);
  clock.refresh(1000, 20000);
  assert.equal(clock.to, 5000);
  assert.equal(clock.time, 3000);
  clock.refresh(4000, 20000);
  assert.equal(clock.from, 2000);
  assert.equal(clock.time, 3000);
  clock.customRange = null;
  clock.refresh(4000, 20000);
  assert.equal(clock.to, 20000);
});

test("player colors are deterministic and distinguish player IDs", async () => {
  const { playerColor } =
    await import("../bluemap-addon/src/bluemap-adapter.js");
  assert.equal(playerColor(7), playerColor(7));
  assert.notEqual(playerColor(1), playerColor(2));
  assert.equal(
    new Set(Array.from({ length: 100 }, (_, i) => playerColor(i))).size,
    100,
  );
});

test("activity histogram keeps gaps empty and represents relative density", async () => {
  const { addActivityBins } =
    await import("../bluemap-addon/src/replay-state.js");
  const bins = Array(4).fill(0);
  addActivityBins(
    bins,
    [
      [0, 10],
      [120000, 40],
      [180000, 20],
    ],
    0,
    240000,
  );
  assert.deepEqual(bins, [10, 0, 40, 20]);
  const clipped = [0, 0];
  addActivityBins(
    clipped,
    [
      [0, 10],
      [60000, 20],
    ],
    30000,
    90000,
  );
  assert.deepEqual(clipped, [5, 10]);
  const single = [0];
  addActivityBins(single, [[60000, 10]], 61000, 61000);
  assert.deepEqual(single, [10]);
});

test("play from the latest endpoint restarts the selected range", () => {
  const clock = new ReplayClock();
  clock.refresh(1000, 10000, true);
  clock.togglePlayback();
  assert.equal(clock.time, 10000 - HISTORY_WINDOW);
  clock.tick(500);
  assert.equal(clock.time, 10500 - HISTORY_WINDOW);
  clock.togglePlayback();
  assert.equal(clock.isPlaying, false);
});
