import assert from "node:assert/strict";
import { test } from "vitest";
import { loadHeatmapRange } from "../src/heatmap-loader.js";

test("heatmap loader merges matching cells across aggregate files", async () => {
  const requests: Array<[string, number]> = [];
  const result = await loadHeatmapRange({
    from: 0,
    to: 120_000,
    chunkDurationMs: 60_000,
    loadPart: async (level, time) => {
      requests.push([level, time]);
      return time === 0
        ? [[1, 2, 3, 4, 10], [9, 9, 9, 9, 2]]
        : [[1, 2, 3, 4, 5]];
    },
  });

  assert.deepEqual(requests, [["chunk", 0], ["chunk", 60_000]]);
  assert.deepEqual(result.rows, [[1, 2, 3, 4, 15], [9, 9, 9, 9, 2]]);
  assert.equal(result.status, "Heatmap · time spent · completed recording chunks");
});

test("heatmap loader reports an empty range", async () => {
  const result = await loadHeatmapRange({
    from: 0,
    to: 60_000,
    chunkDurationMs: 60_000,
    loadPart: async () => [],
  });

  assert.deepEqual(result.rows, []);
  assert.equal(result.status, "No completed heatmap data in this range");
});

test("heatmap loader enforces the browser cell cap", async () => {
  await assert.rejects(
    () =>
      loadHeatmapRange({
        from: 0,
        to: 60_000,
        chunkDurationMs: 60_000,
        maxCells: 1,
        loadPart: async () => [[1, 1, 1, 1, 1], [2, 2, 2, 2, 1]],
      }),
    /Heatmap exceeds the browser cell limit/,
  );
});
