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
