// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { MapAdapter } from "../src/map-adapter.js";
import { updateReplayOverlays, type OverlayCoordinatorInput } from "../src/overlay-coordinator.js";
import type { ChunkCache } from "../src/replay-core.js";

it("updates event visibility when only the replay cursor crosses its timestamp or lifetime", () => {
  const setEvents = vi.fn();
  const input: OverlayCoordinatorInput = {
    adapter: { setEvents, setTrails: vi.fn(), clearHeatmap: vi.fn() } as unknown as MapAdapter,
    cache: { duration: 60000 } as ChunkCache,
    manifest: {
      protocolVersion: 2,
      earliestTimestamp: 1,
      latestTimestamp: 60000,
      chunkDurationMs: 60000,
      cellSize: 16,
      capabilities: {},
      trackingEnabled: {},
      registry: { players: [], worlds: [], items: [] },
    },
    clock: { from: 1, to: 60000, time: 5000 },
    disabledEvents: new Set(),
    events: [
      {
        type: "JOIN",
        payload: {},
        point: { player: 1, time: 10000, world: 0, x: 0, y: 2048, z: 0, flags: 0 },
      },
    ],
    eventRevision: 1,
    filterRevision: 1,
    registryRevision: 1,
    selectionRevision: 1,
    fullTrails: null,
    heatEnabled: false,
    heatRows: null,
    heatVersion: 1,
    isLive: false,
    liveEvents: [],
    livePoints: [],
    names: new Map(),
    rangeEvents: [],
    selection: new Set([1]),
    chatPinned: false,
    timelineRoot: document.createElement("div"),
    chatRoot: document.createElement("div"),
    trailDataKey: null,
    trailMode: 1000,
    world: 0,
    keys: { event: null, heat: null, timeline: null, trail: null },
    timelineWidth: 500,
    requestTrail: vi.fn(),
    trailPending: false,
    schedule: vi.fn(),
    onSelectEvent: vi.fn(),
    onSeek: vi.fn(),
  };
  updateReplayOverlays(input);
  expect(setEvents.mock.calls.at(-1)?.[0]).toHaveLength(0);
  input.clock.time = 10000;
  updateReplayOverlays(input);
  expect(setEvents.mock.calls.at(-1)?.[0]).toHaveLength(1);
  input.clock.time = 12000;
  updateReplayOverlays(input);
  expect(setEvents.mock.calls.at(-1)?.[0]).toHaveLength(0);
});
