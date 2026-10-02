import { mapConcurrent } from "./history-loading.js";
import { BREAK, CONTEXT } from "./replay-core.js";
import type { HistoryChunk, HistoryEvent, HistoryPoint } from "./types.js";

export interface TrailLoadResult {
  from: number;
  to: number;
  points: HistoryPoint[];
  events: HistoryEvent[];
}

interface TrailLoadOptions {
  clockFrom: number;
  clockTo: number;
  clockTime: number;
  trailMode: number;
  duration: number;
  concurrency: number;
  chunkStarts: (from: number, to: number, limit: number) => number[];
  readChunk: (time: number) => Promise<HistoryChunk>;
  onPlan?: (total: number) => void;
  onProgress?: (completed: number, total: number) => void;
  maxChunks?: number;
  maxEvents?: number;
  maxPoints?: number;
}

export const loadTrailData = async ({
  clockFrom,
  clockTo,
  clockTime,
  trailMode,
  duration,
  concurrency,
  chunkStarts,
  readChunk,
  onPlan,
  onProgress,
  maxChunks = 5_000,
  maxEvents = 100_000,
  maxPoints = 100_000,
}: TrailLoadOptions): Promise<TrailLoadResult> => {
  const from =
    trailMode === Infinity
      ? clockFrom
      : Math.max(
          clockFrom,
          Math.floor(clockTime / duration) * duration - (trailMode || 30_000),
        );
  const to =
    trailMode === Infinity
      ? clockTo
      : Math.min(clockTo, (Math.floor(clockTime / duration) + 1) * duration);

  const starts = chunkStarts(from, to, maxChunks);
  onPlan?.(starts.length);
  if (starts.length > maxChunks) {
    throw Error(
      "Full trails exceed 5,000 recording chunks. Choose a shorter range or 30s / 5m trails.",
    );
  }

  const chunks = await mapConcurrent(starts, concurrency, readChunk, onProgress);
  const points: HistoryPoint[] = [];
  const events: HistoryEvent[] = [];
  let previousPlayers = new Set<number>();
  let previousStart: number | undefined;

  for (let index = 0; index < chunks.length; index++) {
    const data = chunks[index];
    const start = starts[index];
    if (!data || start === undefined) continue;

    if (previousStart !== undefined && start !== previousStart + duration) {
      previousPlayers = new Set<number>();
    }

    const seen = new Set<number>();
    events.push(...data.events);
    if (events.length > maxEvents) {
      throw Error("Too many events in this range. Choose a shorter trail duration.");
    }

    for (const point of data.points) {
      seen.add(point.player);
      if ((point.flags & CONTEXT) !== 0 && start !== starts[0]) continue;
      points.push(
        !previousPlayers.has(point.player)
          ? { ...point, flags: point.flags | BREAK }
          : point,
      );
      previousPlayers.add(point.player);
      if (points.length > maxPoints) {
        throw Error("Full trails exceed the browser limit. Use 30s or 5m trails.");
      }
    }

    previousPlayers = seen;
    previousStart = start;
  }

  points.sort((a, b) => a.time - b.time);
  return { from, to, points, events };
};
