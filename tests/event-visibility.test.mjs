import test from "node:test";
import assert from "node:assert/strict";
import { visibleEvents } from "../bluemap-addon/src/replay-state.js";
const events = [0, 10000, 30000, 40000, 50000].map((time) => ({
  type: time === 30000 ? "DEATH" : "JOIN",
  point: { time },
}));
test("events use timeline seconds, never appear in the future, and follow trails", () => {
  assert.deepEqual(
    visibleEvents(events, { from: 0, time: 40000, trailMode: 0 }).map(
      (e) => e.point.time,
    ),
    [10000, 30000, 40000],
  );
  assert.deepEqual(
    visibleEvents(events, { from: 0, time: 40001, trailMode: 0 }).map(
      (e) => e.point.time,
    ),
    [30000, 40000],
  );
  assert.deepEqual(
    visibleEvents(events, { from: 0, time: 40000, trailMode: 10000 }).map(
      (e) => e.point.time,
    ),
    [30000, 40000],
  );
  assert.deepEqual(
    visibleEvents(events, {
      from: 0,
      time: 40000,
      trailMode: Infinity,
      disabled: new Set(["DEATH"]),
    }).map((e) => e.point.time),
    [0, 10000, 40000],
  );
});
