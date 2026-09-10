export const RANGE_OPTIONS = [
  ["0.041666666666666664", "Last hour"],
  ["0.125", "Last 3 hours"],
  ["0.25", "Last 6 hours"],
  ["0.5", "Last 12 hours"],
  ["1", "Last 24 hours"],
  ["2", "Last 48 hours"],
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7", "Last week"],
  ["30", "Last 30 days"],
  ["all", "All history"],
  ["custom", "Last N days…"],
  ["dates", "Custom dates…"],
] as const;

export const rangeOptionLabel = (value: string): string =>
  RANGE_OPTIONS.find(([option]) => option === value)?.[1] ?? "Selected range";

export const calendarRange = (
  value: string,
  now: number,
): { from: number; to: number; followsLive: boolean } | null => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (value === "today") return { from: today.getTime(), to: now, followsLive: true };
  if (value !== "yesterday") return null;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return { from: yesterday.getTime(), to: today.getTime(), followsLive: false };
};

export const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64] as const;

export const TRAIL_OPTIONS = [
  [30_000, "30 seconds"],
  [60_000, "1 minute"],
  [300_000, "5 minutes"],
  [900_000, "15 minutes"],
  [1_800_000, "30 minutes"],
  [3_600_000, "1 hour"],
  [7_200_000, "2 hours"],
  [10_800_000, "3 hours"],
] as const;

export const trailDurationLabel = (value: number): string => {
  if (value === Infinity) return "Full";
  if (value === 0) return "Off";
  if (value < 60_000) return `${value / 1_000}s`;
  if (value < 3_600_000) return `${value / 60_000}m`;
  return `${value / 3_600_000}h`;
};

export const UNAVAILABLE_EVENT_TYPES = [
  "ITEM_PICKUP",
  "ITEM_DROP",
  "BLOCK_PLACE",
  "BLOCK_BREAK",
] as const;

export const DEFAULT_DISABLED_EVENTS = [
  ...UNAVAILABLE_EVENT_TYPES,
  "CONTAINER_OPEN",
  "TELEPORT",
] as const;

export const KNOWN_EVENT_TYPES = [
  "CHAT",
  "JOIN",
  "QUIT",
  "RESPAWN",
  "DEATH",
  "TELEPORT",
  "DIMENSION_CHANGE",
  "CONTAINER_OPEN",
  "DAMAGE_TAKEN",
  "DAMAGE_DEALT",
  "MOB_KILL",
  "PLAYER_KILL",
  "ADVANCEMENT",
  "CRAFT",
  "SMELT",
  "ENCHANT",
  "TRADE",
] as const;
