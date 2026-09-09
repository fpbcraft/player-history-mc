import type { HistoryEvent } from "./types.js";

const firstAfter = (events: readonly HistoryEvent[], time: number): number => {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((events[middle]?.point.time ?? Infinity) <= time) low = middle + 1;
    else high = middle;
  }
  return low;
};

export const chatEventsBetween = (
  events: readonly HistoryEvent[],
  from: number,
  to: number,
  selectedPlayers: ReadonlySet<number>,
): HistoryEvent[] => {
  if (to <= from || events.length === 0) return [];
  const chats: HistoryEvent[] = [];
  for (let index = firstAfter(events, from); index < events.length; index++) {
    const event = events[index];
    if (!event || event.point.time > to) break;
    if (event.type === "CHAT" && selectedPlayers.has(event.point.player)) chats.push(event);
  }
  return chats;
};
