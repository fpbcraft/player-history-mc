import assert from "node:assert/strict";
import { test } from "vitest";
import { LiveFeedState } from "../src/live-feed-state.js";
import type { HistoryEvent, HistoryPoint, LiveSnapshot } from "../src/types.js";

const point = (time: number): HistoryPoint => ({
  player: 1,
  time,
  world: 0,
  x: 0,
  y: 0,
  z: 0,
  flags: 0,
});

const chat = (time: number, message: string): HistoryEvent => ({
  point: point(time),
  type: "CHAT",
  payload: { message },
});

const snapshot = (
  generatedAt: number,
  points: HistoryPoint[] = [],
  events: HistoryEvent[] = [],
  states: LiveSnapshot["states"] = {},
): LiveSnapshot => ({
  protocolVersion: 2,
  generatedAt,
  registry: {
    players: [{ id: 1, uuid: "00000000-0000-0000-0000-000000000001", name: "Player" }],
    worlds: [{ id: 0, key: "minecraft:overworld" }],
    items: [],
  },
  points,
  events,
  states,
});

test("live feed state rejects stale snapshots without initializing chat notifications", () => {
  const state = new LiveFeedState();
  const stale = state.apply(snapshot(1_000, [], [chat(1_000, "old")]), 12_000);
  assert.equal(stale, null);

  const fresh = state.apply(snapshot(12_000, [], [chat(12_000, "first")]), 12_000);
  assert.deepEqual(fresh?.newChats, []);
});

test("live feed state suppresses first-feed chat then reports only unseen chat", () => {
  const state = new LiveFeedState();
  state.apply(snapshot(10_000, [], [chat(1, "a")]), 10_000);

  const next = state.apply(
    snapshot(11_000, [], [chat(1, "a"), chat(2, "b")]),
    11_000,
  );

  assert.deepEqual(next?.newChats.map((event) => event.point.time), [2]);
});

test("live feed state reset restores first-feed suppression", () => {
  const state = new LiveFeedState();
  state.apply(snapshot(10_000, [], [chat(1, "a")]), 10_000);
  state.reset();

  const update = state.apply(snapshot(11_000, [], [chat(2, "b")]), 11_000);
  assert.deepEqual(update?.newChats, []);
});

test("live feed state keeps only the browser live-window caps", () => {
  const state = new LiveFeedState();
  const points = Array.from({ length: 20_005 }, (_, index) => point(index));
  const events = Array.from({ length: 1_005 }, (_, index) => ({
    point: point(index),
    type: "CUSTOM",
    payload: {},
  }));

  const update = state.apply(snapshot(10_000, points, events), 10_000);
  assert.equal(update?.points.length, 20_000);
  assert.equal(update?.points[0]?.time, 5);
  assert.equal(update?.events.length, 1_000);
  assert.equal(update?.events[0]?.point.time, 5);
});


test("live feed state carries current player state with the position snapshot", () => {
  const state = new LiveFeedState();
  const update = state.apply(
    snapshot(10_000, [point(10_000)], [], {
      "1": { sprinting: true, "equipment:head": { item: 2, count: 1 } },
    }),
    10_000,
  );
  assert.deepEqual(update?.states["1"], {
    sprinting: true,
    "equipment:head": { item: 2, count: 1 },
  });
});
