import assert from "node:assert/strict";
import { test } from "vitest";
import { BREAK, CONTEXT } from "../src/replay-core.js";
import { loadTrailData } from "../src/trail-loader.js";
import type { HistoryChunk, HistoryPoint } from "../src/types.js";

const point = (player: number, time: number, flags = 0): HistoryPoint => ({
  player,
  time,
  world: 0,
  x: 0,
  y: 0,
  z: 0,
  flags,
});

const chunk = (points: HistoryPoint[]): HistoryChunk => ({ points, events: [] });

test("trail loader chooses the current bounded trail window", async () => {
  let planned: [number, number] | undefined;
  const result = await loadTrailData({
    clockFrom: 0,
    clockTo: 300_000,
    clockTime: 125_000,
    trailMode: 30_000,
    duration: 60_000,
    concurrency: 2,
    chunkStarts: (from, to) => {
      planned = [from, to];
      return [];
    },
    readChunk: async () => chunk([]),
  });

  assert.deepEqual(planned, [90_000, 180_000]);
  assert.equal(result.from, 90_000);
  assert.equal(result.to, 180_000);
});

test("trail loader preserves full-range mode", async () => {
  let planned: [number, number] | undefined;
  await loadTrailData({
    clockFrom: 10_000,
    clockTo: 900_000,
    clockTime: 125_000,
    trailMode: Infinity,
    duration: 60_000,
    concurrency: 2,
    chunkStarts: (from, to) => {
      planned = [from, to];
      return [];
    },
    readChunk: async () => chunk([]),
  });

  assert.deepEqual(planned, [10_000, 900_000]);
});

test("trail loader stitches contiguous chunks and skips later context samples", async () => {
  const result = await loadTrailData({
    clockFrom: 0,
    clockTo: 120_000,
    clockTime: 60_000,
    trailMode: Infinity,
    duration: 60_000,
    concurrency: 2,
    chunkStarts: () => [0, 60_000],
    readChunk: async (start) =>
      start === 0
        ? chunk([point(1, 10_000), point(2, 20_000)])
        : chunk([point(1, 60_000, CONTEXT), point(1, 70_000), point(3, 80_000)]),
  });

  assert.deepEqual(
    result.points.map(({ player, time, flags }) => ({ player, time, flags })),
    [
      { player: 1, time: 10_000, flags: BREAK },
      { player: 2, time: 20_000, flags: BREAK },
      { player: 1, time: 70_000, flags: 0 },
      { player: 3, time: 80_000, flags: BREAK },
    ],
  );
});

test("trail loader breaks continuity across missing chunks", async () => {
  const result = await loadTrailData({
    clockFrom: 0,
    clockTo: 180_000,
    clockTime: 60_000,
    trailMode: Infinity,
    duration: 60_000,
    concurrency: 2,
    chunkStarts: () => [0, 120_000],
    readChunk: async (start) =>
      start === 0 ? chunk([point(1, 10_000)]) : chunk([point(1, 130_000)]),
  });

  assert.equal(result.points[1]?.flags & BREAK, BREAK);
});

test("trail loader enforces chunk and point caps", async () => {
  await assert.rejects(
    () =>
      loadTrailData({
        clockFrom: 0,
        clockTo: 1,
        clockTime: 0,
        trailMode: Infinity,
        duration: 60_000,
        concurrency: 1,
        maxChunks: 1,
        chunkStarts: () => [0, 60_000],
        readChunk: async () => chunk([]),
      }),
    /Full trails exceed 5,000 recording chunks/,
  );

  await assert.rejects(
    () =>
      loadTrailData({
        clockFrom: 0,
        clockTo: 60_000,
        clockTime: 0,
        trailMode: Infinity,
        duration: 60_000,
        concurrency: 1,
        maxPoints: 1,
        chunkStarts: () => [0],
        readChunk: async () => chunk([point(1, 1), point(2, 2)]),
      }),
    /Full trails exceed the browser limit/,
  );
});
