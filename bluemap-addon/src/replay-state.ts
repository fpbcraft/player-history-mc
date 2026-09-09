import type { HistoryEvent, JsonObject } from "./types.js";

export const HISTORY_WINDOW = 3 * 3_600_000;
export const clamp = (value: number, from: number, to: number): number =>
  Math.max(from, Math.min(to, value));

export const addActivityBins = (
  bins: number[],
  rows: [number, number][],
  from: number,
  to: number,
): void => {
  for (const [time, count] of rows) {
    if (!Number.isFinite(time) || !Number.isFinite(count) || count <= 0) continue;
    if (from === to) {
      if (time <= from && from < time + 60_000) bins[0] = (bins[0] ?? 0) + count;
      continue;
    }
    const low = Math.max(from, time);
    const high = Math.min(to, time + 60_000);
    if (high <= low) continue;
    const width = (to - from) / bins.length;
    const first = Math.max(0, Math.floor((low - from) / width));
    const last = Math.min(bins.length - 1, Math.ceil((high - from) / width) - 1);
    for (let index = first; index <= last; index++) {
      const overlap =
        Math.min(high, from + (index + 1) * width) - Math.max(low, from + index * width);
      bins[index] = (bins[index] ?? 0) + (count * overlap) / 60_000;
    }
  }
};

export interface CustomRange {
  from: number;
  to: number;
}

export class ReplayClock {
  playbackRate = 1;
  rangeDuration = HISTORY_WINDOW;
  customRange: CustomRange | null = null;
  isPlaying = false;
  from = 0;
  to = 0;
  time = Number.NaN;

  get atLatest(): boolean {
    return Number.isFinite(this.time) && this.to - this.time <= 1_000;
  }

  get rate(): number {
    return this.isPlaying ? this.playbackRate : 0;
  }

  refresh(earliest: number, latest: number, reset = false): void {
    const follow = reset || !Number.isFinite(this.time) || this.atLatest;
    this.from = this.customRange
      ? this.customRange.from
      : Number.isFinite(this.rangeDuration)
        ? latest - this.rangeDuration
        : earliest;
    this.to = this.customRange ? this.customRange.to : latest;
    this.seek(follow ? this.to : this.time);
  }

  seek(time: number): void {
    this.time = clamp(time, this.from, this.to);
  }

  togglePlayback(): void {
    if (!this.isPlaying && this.time >= this.to) this.seek(this.from);
    this.isPlaying = !this.isPlaying;
  }

  tick(delta: number): void {
    this.seek(this.time + delta * this.rate);
    if (this.time >= this.to) this.isPlaying = false;
  }
}

export const clusterTimelineEvents = (
  events: HistoryEvent[],
  thresholdMs: number,
): HistoryEvent[][] => {
  const sorted = [...events].sort((left, right) => left.point.time - right.point.time);
  const clusters: HistoryEvent[][] = [];
  for (const event of sorted) {
    const last = clusters.at(-1);
    if (last?.length) {
      const previous = last.at(-1);
      if (previous && event.point.time - previous.point.time <= thresholdMs) {
        last.push(event);
        continue;
      }
    }
    clusters.push([event]);
  }
  return clusters;
};

export interface EventVisibility {
  from: number;
  time: number;
  trailMode: number;
  disabled?: Set<string>;
}

export const visibleEvents = (events: HistoryEvent[], options: EventVisibility): HistoryEvent[] => {
  const disabled = options.disabled ?? new Set<string>();
  const start =
    options.trailMode === Infinity
      ? options.from
      : Math.max(options.from, options.time - (options.trailMode || 30_000));
  return events.filter(
    (event) =>
      !disabled.has(event.type) && event.point.time >= start && event.point.time <= options.time,
  );
};

const productionPayload = (event: HistoryEvent): JsonObject | null => {
  try {
    const value: unknown =
      typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonObject)
      : null;
  } catch {
    return null;
  }
};

/** Combines bursts from one crafting or furnace session into one map event. */
export const combineProductionEvents = (
  events: HistoryEvent[],
  windowMs = 60_000,
): HistoryEvent[] => {
  const result: HistoryEvent[] = [];
  const sessions = new Map<string, { index: number; lastTime: number; count: number }>();
  for (const event of [...events].sort((left, right) => left.point.time - right.point.time)) {
    if (event.type !== "CRAFT" && event.type !== "SMELT") {
      result.push(event);
      continue;
    }
    const payload = productionPayload(event);
    if (!payload) {
      result.push(event);
      continue;
    }
    const key = JSON.stringify([
      event.point.player,
      event.type,
      payload.item ?? payload.name ?? "unknown",
    ]);
    const session = sessions.get(key);
    const amount = typeof payload.count === "number" ? payload.count : 1;
    if (!session || event.point.time - session.lastTime > windowMs) {
      sessions.set(key, { index: result.length, lastTime: event.point.time, count: amount });
      result.push({ ...event, payload: { ...payload, count: amount } });
      continue;
    }
    session.lastTime = event.point.time;
    session.count += amount;
    const first = result[session.index];
    if (first && typeof first.payload !== "string") {
      result[session.index] = {
        ...first,
        payload: { ...first.payload, count: session.count },
      };
    }
  }
  return result;
};
