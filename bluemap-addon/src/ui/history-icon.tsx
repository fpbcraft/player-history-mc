type HistoryIconName = "events" | "heat" | "players" | "speed" | "trails" | "webchat";

const ICON_PATHS: Record<HistoryIconName, string> = {
  events:
    "M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42m0-12.72-1.42 1.42M7.06 16.94l-1.42 1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  heat: "M4 4h5v5H4zM10 4h5v5h-5zM16 4h4v5h-4zM4 10h5v5H4zM10 10h5v5h-5zM16 10h4v5h-4zM4 16h5v4H4zM10 16h5v4h-5zM16 16h4v4h-4z",
  players:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  speed: "M3 18a10 10 0 1 1 18 0M12 14l5-6M5 18h14",
  trails: "M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M19 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4M7 17c4 0 3-10 8-10h2",
  webchat: "M21 11a8 8 0 0 1-8 8H7l-5 3V11a9 9 0 0 1 19 0Z",
};

export const HistoryIcon = ({ name }: { name: HistoryIconName }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={ICON_PATHS[name]} />
  </svg>
);

export const TimelineEventIcon = ({ type }: { type: "chat" | "death" }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d={
        type === "chat"
          ? "M2 2h12v9H7l-4 3v-3H2z"
          : "M3 7a5 5 0 0 1 10 0v4h-2v2H9v-2H7v2H5v-2H3zM5 7h2v2H5zm4 0h2v2H9z"
      }
    />
  </svg>
);
