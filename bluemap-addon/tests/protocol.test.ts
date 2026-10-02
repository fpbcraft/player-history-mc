import assert from "node:assert/strict";
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
    { protocolVersion: 2, generatedAt: 1, registry, points: [], events: [], states: {} },
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
  assert.deepEqual(
    parseLiveSnapshot({
      protocolVersion: 2,
      generatedAt: 1,
      registry,
      points: [],
      events: [],
      states: { "7": { sneaking: true, heldItem: { item: 2, count: 1 } } },
    }).states,
    { "7": { sneaking: true, heldItem: { item: 2, count: 1 } } },
  );
  assert.throws(
    () =>
      parseLiveSnapshot({
        protocolVersion: 2,
        generatedAt: 1,
        registry,
        points: [],
        events: [],
        states: { nope: true },
      }),
    /Invalid live player state/,
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
