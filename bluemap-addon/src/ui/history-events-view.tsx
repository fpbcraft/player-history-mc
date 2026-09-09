import { render } from "preact";
import { eventColor } from "../bluemap-adapter.js";
import { clusterTimelineEvents } from "../replay-state.js";
import { chatMessage } from "../telemetry.js";
import type { HistoryEvent, JsonObject, RegistryPlayer } from "../types.js";
import { TimelineEventIcon } from "./history-icon.js";

interface HistoryEventsProps {
  events: readonly HistoryEvent[];
  from: number;
  to: number;
  timelineWidth: number;
  names: ReadonlyMap<number, string>;
  players: readonly RegistryPlayer[];
  mapRoot?: string;
  formatTime: (time: number) => string;
  onSelect: (event: HistoryEvent) => void;
}

const parsePayload = (event: HistoryEvent): JsonObject | null => {
  try {
    const value: unknown =
      typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
  } catch {
    return null;
  }
};

const ChatHistory = ({
  events,
  names,
  players,
  mapRoot,
  formatTime,
  onSelect,
}: HistoryEventsProps) => {
  const uuids = new Map(players.map((player) => [player.id, player.uuid]));
  const rows = events.flatMap((event) => {
    const payload = parsePayload(event);
    if (!payload) return [];
    return [{ event, payload }];
  });

  if (rows.length === 0) {
    return <div class="history-chat-empty">No chat or player status messages in this range</div>;
  }

  return (
    <>
      {rows.map(({ event, payload }) => {
        const name = names.get(event.point.player) ?? "Player";
        const uuid = uuids.get(event.point.player);
        const head = uuid && mapRoot ? `${mapRoot}/assets/playerheads/${uuid}.png` : undefined;
        const classes =
          event.type === "CHAT"
            ? "history-chat-row"
            : `history-chat-row history-chat-system history-chat-${event.type.toLowerCase()}`;
        return (
          <button
            type="button"
            class={classes}
            key={`${event.point.player}:${event.point.time}:${event.type}`}
            title="Show this message on the map"
            onClick={() => onSelect(event)}
          >
            <span class="history-chat-time">{formatTime(event.point.time)}</span>
            {head ? (
              <img
                class="history-chat-head"
                src={head}
                alt=""
                onError={(error) => {
                  error.currentTarget.hidden = true;
                }}
              />
            ) : (
              <span />
            )}
            <span class="history-chat-message">{chatMessage(event.type, name, payload)}</span>
          </button>
        );
      })}
    </>
  );
};

const TimelineEvents = ({
  events,
  from,
  to,
  timelineWidth,
  names,
  formatTime,
  onSelect,
}: HistoryEventsProps) => {
  const indicatorEvents = events.filter((event) => ["CHAT", "DEATH"].includes(event.type));
  const threshold = ((to - from) * 18) / Math.max(1, timelineWidth || 600);
  return (
    <>
      {clusterTimelineEvents(indicatorEvents, threshold).map((cluster) => {
        const hasChat = cluster.some((event) => event.type === "CHAT");
        const hasDeath = cluster.some((event) => event.type === "DEATH");
        const kind = hasChat && hasDeath ? "chat and death" : hasDeath ? "death" : "chat";
        const middle = cluster.reduce((sum, event) => sum + event.point.time, 0) / cluster.length;
        let current = 0;
        return (
          <button
            type="button"
            key={`${cluster[0]?.point.time}:${cluster.length}:${kind}`}
            class={`history-timeline-event ${hasChat && hasDeath ? "history-mixed-tick" : hasDeath ? "history-death-tick" : "history-chat-tick"}`}
            style={{
              left: `${((middle - from) / Math.max(1, to - from)) * 100}%`,
              color: hasChat && hasDeath ? "#eee" : eventColor(hasDeath ? "DEATH" : "CHAT"),
            }}
            aria-label={`${cluster.length} ${kind} event${cluster.length === 1 ? "" : "s"}; click repeatedly to cycle`}
            onClick={(click) => {
              const event = cluster[current++ % cluster.length];
              if (!event) return;
              onSelect(event);
              click.currentTarget.title = `${formatTime(event.point.time)} · ${event.type.toLowerCase()} · ${names.get(event.point.player) ?? "Player"}`;
            }}
          >
            {hasChat ? <TimelineEventIcon type="chat" /> : null}
            {hasDeath ? <TimelineEventIcon type="death" /> : null}
            {cluster.length > 1 ? <b>{cluster.length}</b> : null}
          </button>
        );
      })}
    </>
  );
};

export const renderHistoryEvents = (
  chatRoot: HTMLElement,
  timelineRoot: HTMLElement,
  props: HistoryEventsProps,
): void => {
  render(<ChatHistory {...props} />, chatRoot);
  render(<TimelineEvents {...props} />, timelineRoot);
};
