import { parseChunk } from "./protocol.js";
import type { Fetcher, HistoryChunk, HistoryPoint, PointSegment } from "./types.js";

export const BREAK = 1;
export const OFFLINE = 2;
export const HOLD = 4;
export const CONTEXT = 8;

export const connects = (from: HistoryPoint, to: HistoryPoint): boolean =>
  !(from.flags & OFFLINE) && from.world === to.world && !(to.flags & BREAK);

export const mergePoints = (chunks: HistoryChunk[]): HistoryPoint[] => {
  const points = chunks.flatMap((chunk) => chunk.points);
  const originals = new Set(
    points
      .filter((point) => !(point.flags & CONTEXT))
      .map((point) => `${point.player}:${point.time}`),
  );
  const seen = new Set<string>();
  return points
    .filter((point) => {
      if (point.flags & CONTEXT && originals.has(`${point.player}:${point.time}`)) return false;
      const key = JSON.stringify(point);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.time - right.time);
};

const pointAt = (from: HistoryPoint, to: HistoryPoint, time: number): HistoryPoint => {
  const ratio = to.time === from.time ? 1 : (time - from.time) / (to.time - from.time);
  return {
    ...from,
    time,
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
    z: from.z + (to.z - from.z) * ratio,
  };
};

export class ReplayEngine {
  readonly players = new Map<number, HistoryPoint[]>();

  constructor(points: HistoryPoint[] = []) {
    this.setPoints(points);
  }

  setPoints(points: HistoryPoint[]): void {
    this.players.clear();
    for (const point of points) {
      const playerPoints = this.players.get(point.player) ?? [];
      playerPoints.push(point);
      this.players.set(point.player, playerPoints);
    }
  }

  position(id: number, time: number): HistoryPoint | null {
    const points = this.players.get(id) ?? [];
    let low = 0;
    let high = points.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const point = points[middle];
      if (point && point.time <= time) low = middle + 1;
      else high = middle;
    }
    if (!low) return null;
    const from = points[low - 1];
    const to = points[low];
    if (!from || from.flags & OFFLINE) return null;
    if (!to || !connects(from, to) || to.time === from.time) return { ...from };
    return pointAt(from, to, time);
  }

  trails(id: number, fromTime: number, toTime: number): PointSegment[] {
    const points = this.players.get(id) ?? [];
    const segments: PointSegment[] = [];
    let line: HistoryPoint[] = [];
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1];
      const to = points[index];
      if (!from || !to) continue;
      if (to.time < fromTime || from.time > toTime || !connects(from, to)) {
        if (line.length > 1) segments.push(line);
        line = [];
        continue;
      }
      const low = Math.max(fromTime, from.time);
      const high = Math.min(toTime, to.time);
      if (high < low) continue;
      if (!line.length) line.push(pointAt(from, to, low));
      line.push(pointAt(from, to, high));
    }
    if (line.length > 1) segments.push(line);
    return segments;
  }
}

export class ChunkCache {
  readonly cache = new Map<number, HistoryChunk>();
  private readonly fetcher: Fetcher;
  private generation = 0;
  private controller?: AbortController;
  private availableRanges: readonly [number, number][] | undefined;

  constructor(
    readonly base: string,
    readonly duration: number,
    fetcher: Fetcher = (...args) => fetch(...args),
    availableRanges?: readonly [number, number][],
  ) {
    this.fetcher = fetcher;
    this.availableRanges = availableRanges;
  }

  setAvailableRanges(ranges?: readonly [number, number][]): void {
    this.availableRanges = ranges;
  }

  private isPublished(start: number): boolean {
    if (!this.availableRanges) return true;
    let low = 0;
    let high = this.availableRanges.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const range = this.availableRanges[middle];
      if (!range || start < range[0]) high = middle;
      else if (start >= range[1]) low = middle + 1;
      else return true;
    }
    return false;
  }

  chunkStarts(from: number, to: number, limit: number): number[] {
    const first = Math.floor(from / this.duration) * this.duration;
    const last = Math.floor(to / this.duration) * this.duration;
    const starts: number[] = [];
    const append = (start: number, end: number) => {
      for (let value = start; value <= end; value += this.duration) {
        starts.push(value);
        if (starts.length > limit) return false;
      }
      return true;
    };
    if (!this.availableRanges) {
      append(first, last);
      return starts;
    }
    for (const [rangeFrom, rangeTo] of this.availableRanges) {
      if (rangeTo <= first || rangeFrom > last) continue;
      const start = Math.max(first, Math.ceil(rangeFrom / this.duration) * this.duration);
      const end = Math.min(last, rangeTo - this.duration);
      if (start <= end && !append(start, end)) break;
    }
    return starts;
  }

  private remember(start: number, chunk: HistoryChunk): HistoryChunk {
    this.cache.set(start, chunk);
    while (this.cache.size > 3) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return chunk;
  }

  async read(start: number, signal?: AbortSignal): Promise<HistoryChunk> {
    const cached = this.cache.get(start);
    if (cached) return cached;
    if (!this.isPublished(start)) {
      const gap = parseChunk({ points: [], events: [] });
      return this.remember(start, gap);
    }
    const response = await this.fetcher(`${this.base}/chunks/${start}.json`, {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok && response.status !== 404) throw new Error(`History HTTP ${response.status}`);
    const text =
      response.status === 404
        ? '{"points":[],"events":[]}'
        : response.text
          ? await response.text()
          : (() => {
              throw new Error("History chunk response is not text");
            })();
    if (text.length > 64 * 1024 * 1024) throw new Error("Chunk exceeds browser size limit");
    const chunk = parseChunk(JSON.parse(text) as unknown);
    if (signal?.aborted) throw new DOMException("Obsolete read", "AbortError");
    return this.remember(start, chunk);
  }

  async window(time: number): Promise<HistoryChunk> {
    this.controller?.abort();
    this.controller = new AbortController();
    const generation = ++this.generation;
    const start = Math.floor(time / this.duration) * this.duration;
    const chunks = await Promise.all(
      [start - this.duration, start, start + this.duration].map((value) =>
        this.read(value, this.controller?.signal),
      ),
    );
    if (generation !== this.generation) throw new DOMException("Obsolete seek", "AbortError");
    const current = chunks[1];
    if (!current) throw new Error("Missing current history chunk");
    return {
      points: current.points.length ? mergePoints(chunks) : [],
      events: chunks.flatMap((chunk) => chunk.events),
    };
  }

  clear(): void {
    this.generation++;
    this.controller?.abort();
    this.cache.clear();
  }
}

export interface HeatmapRequest {
  time: number;
  level: "chunk" | "hour" | "day";
}

export const heatmapPlan = (from: number, to: number, chunk: number): HeatmapRequest[] => {
  const start = Math.floor(from / chunk) * chunk;
  const end = Math.ceil(to / chunk) * chunk;
  const plan: HeatmapRequest[] = [];
  for (let time = start; time < end; ) {
    let span = chunk;
    let level: HeatmapRequest["level"] = "chunk";
    if (time % 86_400_000 === 0 && end - time >= 86_400_000) {
      span = 86_400_000;
      level = "day";
    } else if (time % 3_600_000 === 0 && end - time >= 3_600_000) {
      span = 3_600_000;
      level = "hour";
    }
    plan.push({ time, level });
    time += span;
    if (plan.length > 2_000)
      throw new Error("Heatmap range exceeds 2000 aggregate files; narrow the range");
  }
  return plan;
};
