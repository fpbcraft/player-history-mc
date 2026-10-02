import { mapConcurrent } from "./history-loading.js";
import { addActivityBins } from "./replay-state.js";

const DAY_MS = 86_400_000;
const MAX_DAYS = 2_000;

export const activityRangeTooLarge = (from: number, to: number): boolean => {
  const first = Math.floor(from / DAY_MS) * DAY_MS;
  const last = Math.floor(to / DAY_MS) * DAY_MS;
  return (last - first) / DAY_MS > MAX_DAYS;
};

export interface ActivityDensityResult {
  bins: number[];
  max: number;
  total: number;
  status: string;
  ariaLabel: string;
}

export type ActivityDensityLoad =
  | { kind: "too-large" }
  | { kind: "ready"; density: ActivityDensityResult };

interface ActivityDensityOptions {
  from: number;
  to: number;
  count: number;
  concurrency: number;
  activityReady: boolean | undefined;
  loadDay: (start: number) => Promise<[number, number][]>;
}

export const loadActivityDensity = async ({
  from,
  to,
  count,
  concurrency,
  activityReady,
  loadDay,
}: ActivityDensityOptions): Promise<ActivityDensityLoad> => {
  const first = Math.floor(from / DAY_MS) * DAY_MS;
  const last = Math.floor(to / DAY_MS) * DAY_MS;
  if (activityRangeTooLarge(from, to)) return { kind: "too-large" };

  const starts = Array.from(
    { length: Math.floor((last - first) / DAY_MS) + 1 },
    (_, index) => first + index * DAY_MS,
  );
  const days = await mapConcurrent(starts, concurrency, loadDay);
  const bins = Array<number>(count).fill(0);
  for (const rows of days) addActivityBins(bins, rows, from, to);

  const max = Math.max(0, ...bins);
  const total = Math.round(bins.reduce((sum, value) => sum + value, 0));
  const status =
    activityReady === false
      ? "Recording density · history is still being indexed"
      : max
        ? "Recording density · all players · minute-level counts"
        : "No recorded samples in this range";

  return {
    kind: "ready",
    density: {
      bins,
      max,
      total,
      status,
      ariaLabel:
        "Recording density: approximately " +
        total.toLocaleString() +
        " samples across " +
        count +
        " intervals. Taller bars mean more recorded samples.",
    },
  };
};
