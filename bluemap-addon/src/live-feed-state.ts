import type {
  HistoryEvent,
  HistoryPoint,
  HistoryRegistry,
  LiveSnapshot,
} from "./types.js";

export interface LiveFeedUpdate {
  generatedAt: number;
  registry: HistoryRegistry;
  points: HistoryPoint[];
  events: HistoryEvent[];
  newChats: HistoryEvent[];
}

export class LiveFeedState {
  private seenChatEvents = new Set<string>();
  private initialized = false;

  reset(): void {
    this.seenChatEvents.clear();
    this.initialized = false;
  }

  apply(data: LiveSnapshot, now = Date.now()): LiveFeedUpdate | null {
    if (
      data.protocolVersion !== 2 ||
      !Number.isFinite(data.generatedAt) ||
      now - data.generatedAt > 10_000
    ) {
      return null;
    }

    const points = Array.isArray(data.points) ? data.points.slice(-20_000) : [];
    const events = Array.isArray(data.events) ? data.events.slice(-1_000) : [];
    const newChats: HistoryEvent[] = [];

    for (const event of events) {
      if (event.type !== "CHAT") continue;
      const key = `${event.point.player}:${event.point.time}:${JSON.stringify(event.payload)}`;
      if (this.initialized && !this.seenChatEvents.has(key)) newChats.push(event);
      this.seenChatEvents.add(key);
    }

    while (this.seenChatEvents.size > 2_000) {
      const oldest = this.seenChatEvents.values().next().value;
      if (oldest === undefined) break;
      this.seenChatEvents.delete(oldest);
    }

    this.initialized = true;
    return {
      generatedAt: data.generatedAt,
      registry: data.registry,
      points,
      events,
      newChats,
    };
  }
}
