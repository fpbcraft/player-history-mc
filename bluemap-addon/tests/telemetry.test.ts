import assert from "node:assert/strict";
import { test } from "vitest";
import {
  chatMessage,
  describeState,
  eventDetails,
  stateAt,
  TelemetryCache,
  trailPoint,
} from "../src/telemetry.js";

const a = { player: 1, time: 0, x: -320, y: 0, z: 0, world: 0, flags: 0 };
const b = { ...a, time: 10000, x: 0 };
test("trail hover resolves exact segment time and clamps endpoints", () => {
  for (const [x, time] of [
    [-20, 0],
    [-10, 0],
    [-5, 5000],
    [0, 10000],
    [10, 10000],
  ])
    assert.equal(trailPoint([a, b], 0, { x, y: 0, z: 0 }).time, time);
  assert.equal(
    trailPoint([a, b, { ...b, x: 320, time: 20000 }], 1, { x: 5, y: 0, z: 0 }).time,
    15000,
  );
});
test("trail hover rejects discontinuities and invalid hits", () => {
  for (const flags of [1, 3, 9])
    assert.equal(trailPoint([a, { ...b, flags }], 0, { x: 0, y: 0, z: 0 }), null);
  assert.equal(trailPoint([{ ...a, flags: 2 }, b], 0, { x: 0, y: 0, z: 0 }), null);
  assert.equal(trailPoint([a, { ...b, world: 1 }], 0, { x: 0, y: 0, z: 0 }), null);
  assert.equal(trailPoint([a, b], 9, { x: 0, y: 0, z: 0 }), null);
});
test("state and inventory reconstruction respects unknown and disabled fields", () => {
  const records = [
    {
      player: 1,
      time: 10,
      kind: "checkpoint",
      values: { health: 20, "slot:0": { item: 1, count: 2 } },
    },
    {
      player: 1,
      time: 20,
      kind: "delta",
      values: { "slot:0": { item: 0, count: 0 }, health: null },
    },
    { player: 1, time: 30, kind: "unknown", values: {} },
    { player: 1, time: 40, kind: "delta", values: { health: 5 } },
  ];
  assert.equal(stateAt(records, 1, 9), null);
  assert.equal(stateAt(records, 1, 15)["slot:0"].count, 2);
  assert.deepEqual(stateAt(records, 1, 25), {
    health: null,
    "slot:0": { item: 0, count: 0 },
  });
  assert.equal(stateAt(records, 1, 40), null);
  assert.equal(stateAt(records, 2, 25), null);
  assert.match(
    describeState(stateAt(records, 1, 25), { items: [] }, { health: true, inventory: true }),
    /Health: unknown/,
  );
});

test("state details list visible Curios slots", () => {
  const text = describeState(
    { "curio:back:0": { item: 1, count: 1 }, "curio:head:0": { item: 2, count: 1 } },
    {
      items: [
        { id: 1, key: "sophisticatedbackpacks:diamond_backpack" },
        { id: 2, key: "create:goggles" },
      ],
    },
    { curios: true },
  );
  assert.match(text, /Back #1: Sophisticatedbackpacks:diamond Backpack/);
  assert.match(text, /Head #1: Create:goggles/);
});

test("chat display includes Minecraft-style status and death messages", () => {
  assert.equal(chatMessage("CHAT", "Alex", { message: "hello" }), "Alex: hello");
  assert.equal(chatMessage("JOIN", "Alex"), "Alex joined the game");
  assert.equal(chatMessage("QUIT", "Alex"), "Alex left the game");
  assert.equal(
    chatMessage("DEATH", "Alex", { message: "Alex fell from a high place" }),
    "Alex fell from a high place",
  );
});

test("missing state chunks never extrapolate from another chunk; cache is bounded", async () => {
  let requests = 0;
  const cache = new TelemetryCache(
    new URL("https://fixture.invalid/history/"),
    100,
    async (url) => {
      requests++;
      return {
        ok: true,
        status: 200,
        json: async () =>
          String(url).endsWith("/0.json")
            ? [
                {
                  player: 1,
                  time: 10,
                  kind: "checkpoint",
                  values: { health: 20 },
                },
              ]
            : [],
      };
    },
  );
  assert.equal((await cache.at(1, 20)).health, 20);
  assert.equal(await cache.at(1, 120), null);
  for (let i = 2; i < 10; i++) await cache.at(1, i * 100 + 1);
  assert.equal(cache.chunks.size, 4);
  assert.equal(requests, 10);
});

test("event details resolve IDs and coordinates into readable lines without JSON", async () => {
  const { eventDetails } = await import("../src/telemetry.js");
  const text = eventDetails(
    JSON.stringify({
      from: { x: 32, y: 64, z: -32, world: 0 },
      item: 2,
      count: 3,
      damage: 27,
      source: "minecraft:fall",
    }),
    {
      worlds: [{ id: 0, key: "minecraft:overworld" }],
      items: [{ id: 2, key: "minecraft:diamond_sword" }],
    },
  );
  assert.match(text, /From: 1.0, 2.0, -1.0 · Overworld/);
  assert.match(text, /Item: Diamond Sword/);
  assert.match(text, /Count: 3/);
  assert.doesNotMatch(text, /Damage/);
  assert.doesNotMatch(text, /[{}]/);
});

test("event details keep only fields relevant to each event type", () => {
  const death = eventDetails(
    {
      message: "Alex hit the ground too hard",
      from: { x: 0, y: 0, z: 0, world: 0 },
      to: { x: 32, y: 0, z: 0, world: 0 },
    },
    {},
    "DEATH",
  );
  assert.equal(death, "Alex hit the ground too hard");
  assert.doesNotMatch(death, /From|To|Position/);
  const damage = eventDetails(
    {
      targetType: "minecraft:zombie",
      source: "player",
      amount: 6,
      healthAfter: 0,
      unrelated: "ignored",
    },
    {},
    "DAMAGE_DEALT",
  );
  assert.match(damage, /Target Type: Zombie/);
  assert.doesNotMatch(damage, /Unrelated/);
});

test("default fetch does not bind the browser fetch receiver to the cache", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = function () {
    assert.equal(this, undefined);
    called = true;
    return Promise.resolve({
      ok: true,
      json: async () => [{ player: 1, time: 10, kind: "checkpoint", values: { health: 20 } }],
    });
  };
  try {
    const cache = new TelemetryCache(new URL("https://fixture.invalid/"), 100);
    assert.equal((await cache.at(1, 20)).health, 20);
    assert.ok(called);
  } finally {
    globalThis.fetch = original;
  }
});
