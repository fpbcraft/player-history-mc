import { mapConcurrent } from "./history-loading.js";
import type { HistoryEvent } from "./types.js";

export type RangeEventsLoad =
  | { kind: "too-large" }
  | { kind: "ready"; events: HistoryEvent[] };

interface RangeEventsOptions {
  from: number;
  to: number;
  concurrency: number;
  chunkStarts: (from: number, to: number, limit: number) => number[];
  readChunk: (time: number) => Promise<{ events: HistoryEvent[] }>;
  maxChunks?: number;
  maxEvents?: number;
}

export const loadRangeEvents = async ({
  from,
  to,
  concurrency,
  chunkStarts,
  readChunk,
  maxChunks = 5_000,
  maxEvents = 100_000,
}: RangeEventsOptions): Promise<RangeEventsLoad> => {
  const starts = chunkStarts(from, to, maxChunks);
  if (starts.length > maxChunks) return { kind: "too-large" };

  const events: HistoryEvent[] = [];
  const chunks = await mapConcurrent(starts, concurrency, readChunk);
  for (const chunk of chunks) {
    events.push(...chunk.events);
    if (events.length > maxEvents) throw Error("Too many events in this range");
  }
  events.sort((a, b) => a.point.time - b.point.time);
  return { kind: "ready", events };
};
