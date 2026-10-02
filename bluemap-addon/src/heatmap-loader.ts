import type { HeatmapRow } from "./overlay-coordinator.js";
import { heatmapPlan } from "./replay-core.js";

export interface HeatmapLoadResult {
  rows: HeatmapRow[];
  status: string;
}

interface HeatmapLoadOptions {
  from: number;
  to: number;
  chunkDurationMs: number;
  loadPart: (level: string, time: number) => Promise<number[][]>;
  maxCells?: number;
}

export const loadHeatmapRange = async ({
  from,
  to,
  chunkDurationMs,
  loadPart,
  maxCells = 100_000,
}: HeatmapLoadOptions): Promise<HeatmapLoadResult> => {
  const cells = new Map<string, HeatmapRow>();
  for (const part of heatmapPlan(from, to, chunkDurationMs)) {
    for (const row of await loadPart(part.level, part.time)) {
      const typed = row as HeatmapRow;
      const key = typed.slice(0, 4).join(":");
      const existing = cells.get(key);
      if (existing) existing[4] += typed[4];
      else cells.set(key, [...typed]);
      if (cells.size > maxCells) throw Error("Heatmap exceeds the browser cell limit.");
    }
  }

  return {
    rows: [...cells.values()],
    status: cells.size
      ? "Heatmap · time spent · completed recording chunks"
      : "No completed heatmap data in this range",
  };
};
