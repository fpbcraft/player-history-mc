import assert from "node:assert/strict";
import { test } from "vitest";
import { loadActivityDensity } from "../src/activity-density.js";

const DAY = 86_400_000;

test("activity density rejects ranges over 2,000 days without loading", async () => {
  let calls = 0;
  const result = await loadActivityDensity({
    from: 0,
    to: 2_001 * DAY,
    count: 12,
    concurrency: 4,
    activityReady: true,
    loadDay: async () => {
      calls++;
      return [];
    },
  });

  assert.deepEqual(result, { kind: "too-large" });
  assert.equal(calls, 0);
});

test("activity density loads daily rows and aggregates accessible summary", async () => {
  const starts: number[] = [];
  const result = await loadActivityDensity({
    from: 0,
    to: DAY,
    count: 12,
    concurrency: 2,
    activityReady: true,
    loadDay: async (start) => {
      starts.push(start);
      return start === 0 ? [[0, 60]] : [[DAY, 120]];
    },
  });

  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.deepEqual(starts.sort((a, b) => a - b), [0, DAY]);
  assert.equal(result.density.total, 180);
  assert.equal(result.density.max > 0, true);
  assert.equal(result.density.status, "Recording density · all players · minute-level counts");
  assert.match(result.density.ariaLabel, /180 samples across 12 intervals/);
});

test("activity density preserves indexing status even when the range is empty", async () => {
  const result = await loadActivityDensity({
    from: 0,
    to: DAY - 1,
    count: 12,
    concurrency: 2,
    activityReady: false,
    loadDay: async () => [],
  });

  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.equal(result.density.total, 0);
  assert.equal(result.density.status, "Recording density · history is still being indexed");
});
