import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { parseChunk, parseLiveSnapshot, parseManifest } from "../src/protocol.js";

const registry = { players: [], worlds: [], items: [] };

test("protocol parsers reject malformed public data", () => {
  assert.throws(() => parseChunk({ points: [{}], events: [] }), /Invalid player/);
  assert.throws(() => parseChunk({ points: [], events: [{}] }), /Invalid event payload/);
  assert.throws(
    () =>
      parseManifest({
        protocolVersion: 1,
        earliestTimestamp: 0,
        latestTimestamp: 1,
        chunkDurationMs: 1,
        cellSize: 1,
        capabilities: {},
        registry,
      }),
    /Unsupported history version/,
  );
});

test("live parser validates complete points and registry entries", () => {
  assert.deepEqual(
    parseLiveSnapshot({ protocolVersion: 2, generatedAt: 1, registry, points: [], events: [] }),
    { protocolVersion: 2, generatedAt: 1, registry, points: [], events: [] },
  );
  assert.throws(
    () =>
      parseLiveSnapshot({
        protocolVersion: 2,
        generatedAt: 1,
        registry,
        points: [{ time: 1 }],
        events: [],
      }),
    /Invalid player/,
  );
});

test("manifest validates the optional published chunk index", () => {
  const manifest = {
    protocolVersion: 2,
    earliestTimestamp: 100,
    latestTimestamp: 500,
    chunkDurationMs: 100,
    capabilities: {},
    registry,
  };
  assert.deepEqual(
    parseManifest({
      ...manifest,
      chunkRanges: [
        [100, 300],
        [400, 500],
      ],
    }).chunkRanges,
    [
      [100, 300],
      [400, 500],
    ],
  );
  assert.throws(
    () =>
      parseManifest({
        ...manifest,
        chunkRanges: [
          [100, 300],
          [200, 400],
        ],
      }),
    /not sorted/,
  );
  assert.throws(() => parseManifest({ ...manifest, chunkRanges: [[150, 300]] }), /chunk range/);
});


const fixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(`../../protocol/fixtures/${name}`, import.meta.url), "utf8"));

test("shared manifest fixture remains browser-compatible", async () => {
  const manifest = parseManifest(await fixture("manifest-v2.json"));
  assert.equal(manifest.protocolVersion, 2);
  assert.equal(manifest.chunkDurationMs, 60_000);
  assert.equal(manifest.registry.players[0]?.name, "Fixture");
});

test("shared live fixture remains browser-compatible", async () => {
  const live = parseLiveSnapshot(await fixture("live-v2.json"));
  assert.equal(live.protocolVersion, 2);
  assert.equal(live.points.length, 1);
  assert.equal(live.events[0]?.type, "CHAT");
});
