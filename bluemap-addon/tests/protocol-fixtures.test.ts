import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { parseChunk, parseLiveSnapshot, parseManifest } from "../src/protocol.js";

const fixture = async (name: string): Promise<unknown> =>
  JSON.parse(
    await readFile(
      new URL(`../../protocol/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  );

test("shared manifest fixture is accepted by the browser protocol parser", async () => {
  const parsed = parseManifest(await fixture("manifest-v2.json"));
  assert.equal(parsed.protocolVersion, 2);
  assert.deepEqual(parsed.chunkRanges, [[0, 60000]]);
  assert.equal(parsed.registry.players[0]?.name, "Test");
  assert.equal(parsed.registry.worlds[0]?.key, "minecraft:overworld");
});

test("shared chunk fixture is accepted by the browser protocol parser", async () => {
  const parsed = parseChunk(await fixture("chunk-v2.json"));
  assert.equal(parsed.points.length, 1);
  assert.equal(parsed.points[0]?.player, 1);
  assert.equal(parsed.points[0]?.flags, 1);
  assert.deepEqual(parsed.events, []);
});


test("shared live fixture is accepted by the browser protocol parser", async () => {
  const parsed = parseLiveSnapshot(await fixture("live-v2.json"));
  assert.equal(parsed.protocolVersion, 2);
  assert.equal(parsed.points.length, 1);
  assert.equal(parsed.points[0]?.player, 1);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0]?.type, "CHAT");
  assert.equal(parsed.states?.["1"]?.sprinting, true);
  assert.deepEqual(parsed.states?.["1"]?.heldItem, { item: 1, count: 1 });
});
