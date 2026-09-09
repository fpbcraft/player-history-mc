import type { BlueMapAdapter } from "./bluemap-adapter.js";
import { type ChunkCache, mergePoints, ReplayEngine } from "./replay-core.js";
import { combineProductionEvents, visibleEvents } from "./replay-state.js";
import { formatDate } from "./time-format.js";
import type { HistoryEvent, HistoryManifest, HistoryPoint } from "./types.js";
import { renderHistoryEvents } from "./ui/history-events-view.js";

export type HeatmapRow = [number, number, number, number, number];

export interface OverlayKeys {
  event: string | null;
  heat: string | null;
  timeline: string | null;
  trail: string | null;
}

export interface OverlayCoordinatorInput {
  adapter: BlueMapAdapter | undefined;
  cache: ChunkCache | undefined;
  clock: { from: number; to: number; time: number };
  disabledEvents: ReadonlySet<string>;
  events: readonly HistoryEvent[];
  eventRevision: number;
  filterRevision: number;
  fullTrails: ReplayEngine | null;
  heatEnabled: boolean;
  heatRows: readonly HeatmapRow[] | null;
  heatVersion: number;
  isLive: boolean;
  liveEvents: readonly HistoryEvent[];
  livePoints: readonly HistoryPoint[];
  manifest: HistoryManifest | undefined;
  names: ReadonlyMap<number, string>;
  mapRoot?: string;
  registryRevision: number;
  rangeEvents: readonly HistoryEvent[];
  selection: ReadonlySet<number>;
  selectionRevision: number;
  chatPinned: boolean;
  timelineRoot: HTMLElement;
  chatRoot: HTMLElement;
  trailDataKey: string | null;
  trailMode: number;
  world: number | undefined;
  keys: OverlayKeys;
  timelineWidth: number;
  requestTrail: (dataKey: string) => void;
  trailPending: boolean;
  schedule: (callback: FrameRequestCallback) => void;
  onSelectEvent: (event: HistoryEvent) => void;
  onSeek: (time: number) => void;
}

export const updateReplayOverlays = (input: OverlayCoordinatorInput): OverlayKeys => {
  const { adapter, cache, manifest } = input;
  if (!adapter || !cache || !manifest || !Number.isFinite(input.clock.time)) return input.keys;

  const { from, to, time } = input.clock;
  const full = input.trailMode === Infinity;
  const start = full ? from : Math.max(from, time - input.trailMode);
  const dataKey = [
    String(input.trailMode),
    input.isLive ? Math.floor(from / cache.duration) : from,
    input.isLive ? Math.floor(to / cache.duration) : to,
    full ? "full" : Math.floor(time / cache.duration),
  ].join(":");
  if (input.trailDataKey !== dataKey && !input.trailPending) input.requestTrail(dataKey);

  const historyEngine = input.trailDataKey === dataKey ? input.fullTrails : null;
  const engine = input.isLive
    ? new ReplayEngine(
        mergePoints([
          {
            points: [...(historyEngine?.players.values() || [])].flatMap((points) => [...points]),
            events: [],
          },
          { points: [...input.livePoints], events: [] },
        ]),
      )
    : historyEngine;
  const trailKey = [
    dataKey,
    start,
    full ? to : time,
    input.selectionRevision,
    input.world,
    !!engine,
    input.registryRevision,
  ].join(":");
  if (trailKey !== input.keys.trail) {
    input.keys.trail = trailKey;
    adapter.setTrails(
      input.trailMode && engine
        ? [...input.selection]
            .flatMap((id) => engine.trails(id, start, full ? to : time))
            .filter((line) => line[0]?.world === input.world)
        : [],
      new Map(input.names),
    );
  }

  const combined = new Map(
    [...input.rangeEvents, ...input.events, ...(input.isLive ? input.liveEvents : [])].map(
      (event) => [JSON.stringify([event.point, event.type, event.payload]), event],
    ),
  );
  const selectedTimelineEvents = [...combined.values()]
    .sort((a, b) => a.point.time - b.point.time)
    .filter(
      (event) =>
        input.selection.has(event.point.player) &&
        event.point.time >= from &&
        event.point.time <= to,
    );
  const timelineEvents = combineProductionEvents(selectedTimelineEvents).filter(
    (event) => !input.disabledEvents.has(event.type),
  );
  const events = visibleEvents(timelineEvents, {
    from,
    time,
    trailMode: input.trailMode,
    disabled: new Set(input.disabledEvents),
  }).slice(-500);
  const eventKey = [
    input.eventRevision,
    input.filterRevision,
    input.selectionRevision,
    input.world,
    from,
    to,
    input.registryRevision,
  ].join(":");
  if (input.keys.event !== eventKey) {
    input.keys.event = eventKey;
    adapter.setEvents(
      events.filter((event) => event.point.world === input.world),
      new Map(input.names),
      input.onSeek,
      manifest.registry,
    );
  }

  const chatEvents = selectedTimelineEvents
    .filter((event) => ["CHAT", "JOIN", "QUIT", "DEATH"].includes(event.type))
    .slice(-1000);
  const timelineKey = `${input.eventRevision}:${input.registryRevision}:${from}:${to}`;
  if (input.keys.timeline !== timelineKey) {
    input.keys.timeline = timelineKey;
    renderHistoryEvents(input.chatRoot, input.timelineRoot, {
      events: chatEvents,
      from,
      to,
      timelineWidth: input.timelineWidth,
      names: input.names,
      players: manifest.registry.players,
      ...(input.mapRoot ? { mapRoot: input.mapRoot } : {}),
      formatTime: formatDate,
      onSelect: input.onSelectEvent,
    });
    if (input.chatPinned)
      input.schedule(() => {
        input.chatRoot.scrollTop = input.chatRoot.scrollHeight;
      });
  }

  const heatKey = [input.heatVersion, input.selectionRevision, input.world, input.heatEnabled].join(
    ":",
  );
  if (input.keys.heat !== heatKey) {
    input.keys.heat = heatKey;
    if (input.heatEnabled && input.heatRows) {
      const cells = new Map<string, HeatmapRow>();
      for (const row of input.heatRows) {
        if (!input.selection.has(row[0]) || row[1] !== input.world) continue;
        const key = `${row[2]},${row[3]}`;
        const old = cells.get(key);
        if (old) old[4] += row[4];
        else cells.set(key, [...row]);
      }
      adapter.setHeatmap([...cells.values()], manifest.cellSize, 0.55);
    } else adapter.clearHeatmap();
  }
  return input.keys;
};
