const KEYS = {
  range: "player-history-range",
  days: "player-history-custom-days",
  speed: "player-history-speed",
  players: "player-history-players",
  hiddenEvents: "player-history-hidden-events",
  trails: "player-history-trails",
  heatmap: "player-history-heatmap",
  chatToken: "player-history-chat-token",
  historyOpen: "player-history-open",
  chatOpen: "player-history-chat-open",
} as const;

const readBoolean = (key: string): boolean => localStorage.getItem(key) === "true";

const readArray = (key: string): unknown[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

export const preferences = {
  range: (): string | null => localStorage.getItem(KEYS.range),
  saveRange: (value: string): void => localStorage.setItem(KEYS.range, value),
  days: (): number | null => {
    const value = Number(localStorage.getItem(KEYS.days));
    return Number.isInteger(value) && value > 0 && value <= 36_500 ? value : null;
  },
  saveDays: (value: number): void => localStorage.setItem(KEYS.days, String(value)),
  speed: (): number | null => {
    const value = Number(localStorage.getItem(KEYS.speed));
    return [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64].includes(value) ? value : null;
  },
  saveSpeed: (value: number): void => localStorage.setItem(KEYS.speed, String(value)),
  players: (): number[] | null => {
    if (localStorage.getItem(KEYS.players) === null) return null;
    return readArray(KEYS.players).filter((value): value is number => Number.isFinite(value));
  },
  savePlayers: (value: Iterable<number>): void =>
    localStorage.setItem(KEYS.players, JSON.stringify([...value])),
  hiddenEvents: (): string[] =>
    readArray(KEYS.hiddenEvents).filter((value): value is string => typeof value === "string"),
  saveHiddenEvents: (value: Iterable<string>): void =>
    localStorage.setItem(KEYS.hiddenEvents, JSON.stringify([...value])),
  trails: (): number | null => {
    const stored = localStorage.getItem(KEYS.trails);
    if (stored === "Infinity") return Infinity;
    const value = Number(stored);
    return Number.isFinite(value) ? value : null;
  },
  saveTrails: (value: number): void => localStorage.setItem(KEYS.trails, String(value)),
  heatmap: (): boolean => localStorage.getItem(KEYS.heatmap) === "true",
  saveHeatmap: (value: boolean): void => localStorage.setItem(KEYS.heatmap, String(value)),
  chatToken: (): string => localStorage.getItem(KEYS.chatToken) ?? "",
  saveChatToken: (value: string): void => {
    if (value) localStorage.setItem(KEYS.chatToken, value);
    else localStorage.removeItem(KEYS.chatToken);
  },
  historyOpen: (): boolean => readBoolean(KEYS.historyOpen),
  saveHistoryOpen: (value: boolean): void => localStorage.setItem(KEYS.historyOpen, String(value)),
  chatOpen: (): boolean => readBoolean(KEYS.chatOpen),
  saveChatOpen: (value: boolean): void => localStorage.setItem(KEYS.chatOpen, String(value)),
};
