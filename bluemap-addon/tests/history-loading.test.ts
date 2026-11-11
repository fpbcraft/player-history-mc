import assert from "node:assert/strict";
import { test } from "vitest";
import { mapConcurrent } from "../src/history-loading.js";

test("bounded loading preserves input order", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapConcurrent([3, 2, 1, 0], 2, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value));
    active--;
    return value * 2;
  });
  assert.deepEqual(results, [6, 4, 2, 0]);
  assert.equal(peak, 2);
});

test("ordered consumption stops scheduling after a browser limit is reached", async () => {
  const { consumeConcurrent } = await import("../src/history-loading.js");
  let reads = 0;
  const consumed: number[] = [];
  await assert.rejects(
    consumeConcurrent(
      Array.from({ length: 5_000 }, (_, i) => i),
      3,
      async (value) => {
        reads++;
        return value;
      },
      (value) => {
        consumed.push(value);
        if (value === 1) throw Error("limit");
      },
    ),
    /limit/,
  );
  assert.deepEqual(consumed, [0, 1]);
  assert.equal(reads, 3);
});
