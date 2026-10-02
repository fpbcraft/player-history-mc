import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRangeEvents } from "../src/range-events-loader.js";
import type { HistoryEvent } from "../src/types.js";

const event = (time: number): HistoryEvent => ({
  point: { player: 1, time, world: 0, x: 0, y: 0, z: 0, flags: 0 },
  type: "CUSTOM",
  payload: {},
});

test("range event loader rejects ranges over the chunk cap without reading", async () => {
  let reads = 0;
  const result = await loadRangeEvents({
    from: 0,
    to: 10,
    concurrency: 2,
    maxChunks: 2,
    chunkStarts: () => [0, 1, 2],
    readChunk: async () => {
      reads++;
      return { events: [] };
    },
  });

  assert.deepEqual(result, { kind: "too-large" });
  assert.equal(reads, 0);
});

test("range event loader aggregates and sorts chunk events", async () => {
  const result = await loadRangeEvents({
    from: 0,
    to: 10,
    concurrency: 2,
    chunkStarts: () => [0, 1],
    readChunk: async (time) => ({
      events: time === 0 ? [event(20), event(5)] : [event(10)],
    }),
  });

  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.deepEqual(result.events.map((row) => row.point.time), [5, 10, 20]);
});

test("range event loader enforces the browser event cap", async () => {
  await assert.rejects(
    () =>
      loadRangeEvents({
        from: 0,
        to: 10,
        concurrency: 1,
        maxEvents: 1,
        chunkStarts: () => [0],
        readChunk: async () => ({ events: [event(1), event(2)] }),
      }),
    /Too many events in this range/,
  );
});
