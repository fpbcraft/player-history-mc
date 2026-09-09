import type { HistoryPoint } from "./types.js";

const EVENT_TYPES = [
  "CHAT",
  "JOIN",
  "QUIT",
  "RESPAWN",
  "DEATH",
  "TELEPORT",
  "DIMENSION_CHANGE",
  "BLOCK_BREAK",
  "BLOCK_PLACE",
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
  "ITEM_PICKUP",
  "ITEM_DROP",
] as const;

export const playerColor = (id: number): string => `hsl(${(id * 137.508 + 195) % 360}, 78%, 65%)`;

export const eventColor = (type: string): string => {
  const index = EVENT_TYPES.indexOf(type as (typeof EVENT_TYPES)[number]);
  const hue =
    index >= 0
      ? (index * 137.508) % 360
      : [...type].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) % 360, 0);
  return `hsl(${hue}, 82%, 66%)`;
};

export const FALLBACK_HEAD = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><path fill="#b68763" d="M0 0h8v8H0z"/><path fill="#493222" d="M0 0h8v2H0zM0 2h1v1H0zM7 2h1v1H7z"/><path fill="#fff" d="M1 4h2v1H1zM5 4h2v1H5z"/><path fill="#524b88" d="M2 4h1v1H2zM5 4h1v1H5z"/><path fill="#68452f" d="M2 6h4v2H2z"/><path fill="#b68763" d="M3 6h2v1H3z"/></svg>',
)}`;

export const formatTimestamp = (time: number): string => new Date(time).toLocaleString();
export const formatShortTimestamp = (time: number): string =>
  new Date(time).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
export const formatCoordinates = (point: HistoryPoint): string =>
  [point.x, point.y, point.z].map((value) => (value / 32).toFixed(1)).join(", ");

const EVENT_PATHS: Record<string, string> = {
  CRAFT: "M3 3h18v18H3zM9 3v18m6-18v18M3 9h18M3 15h18",
  SMELT: "M13 2c2 7 7 8 7 13a8 8 0 01-16 0c0-3 2-5 5-7-1 5 3 6 4 1z",
  ENCHANT: "m4 20 12-12m-9 9-3-3M17 2v4m-2-2h4M5 3v4M3 5h4m12 10v6m-3-3h6",
  TRADE: "M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4",
  ITEM_PICKUP: "M3 15v6h18v-6M12 3v12m-4-4 4 4 4-4",
  ITEM_DROP: "M3 15v6h18v-6M12 15V3m-4 4 4-4 4 4",
  MOB_KILL: "M5 5h14v10l-7 6-7-6zM8 8l3 3m-3 0 3-3m2 0 3 3m-3 0 3-3",
  PLAYER_KILL: "M8 4h8v7H8zM4 21v-5l8-3 8 3v5M9 6l6 3m-6 0 6-3",
  DEATH: "M5 14V8a7 7 0 0114 0v6l-3 2v5H8v-5z M8 9h1m6 0h1M10 18v3m4-3v3",
  TELEPORT: "M8 3H3v18h5m8-18h5v18h-5M7 12h10m-4-4 4 4-4 4",
  DIMENSION_CHANGE: "M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5m-9 5v10",
  BLOCK_BREAK: "m3 3 7 7-3 4 5 7 2-8 7-10M3 3h18v18H3z",
  BLOCK_PLACE: "M3 3h18v18H3zM12 7v10m-5-5h10",
  CONTAINER_OPEN: "M3 8h18v13H3zM3 8l3-5h12l3 5M3 12h18m-9-2v5",
  ADVANCEMENT: "m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z",
  DAMAGE_TAKEN: "m12 3-9 4v6l9 8 9-8V7zM12 7v6m0 3v1",
  DAMAGE_DEALT: "m4 20 4-4m-3-3 6 6m-3-6L18 3h3v3L11 16",
  RESPAWN: "M4 10a8 8 0 111 8M4 3v7h7",
  JOIN: "M14 3h7v18h-7M3 12h13m-4-4 4 4-4 4",
  QUIT: "M10 3H3v18h7m0-9h11m-4-4 4 4-4 4",
};

export const createEventIcon = (type: string): SVGSVGElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", EVENT_PATHS[type] ?? "M5 5h14v14H5zM8 12h8m-4-4v8");
  svg.append(path);
  return svg;
};
