export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface HistoryPoint {
  player: number;
  time: number;
  world: number;
  x: number;
  y: number;
  z: number;
  flags: number;
}

export interface HistoryEvent {
  point: HistoryPoint;
  type: string;
  payload: JsonObject | string;
}

export interface HistoryChunk {
  points: HistoryPoint[];
  events: HistoryEvent[];
}

export interface StateRecord {
  player: number;
  time: number;
  kind: "checkpoint" | "delta" | "unknown";
  values: JsonObject;
}

export interface RegistryPlayer {
  id: number;
  uuid: string;
  name: string;
}

export interface RegistryWorld {
  id: number;
  key: string;
}

export interface RegistryItem {
  id: number;
  key: string;
}

export interface HistoryRegistry {
  players: RegistryPlayer[];
  worlds: RegistryWorld[];
  items: RegistryItem[];
}

export interface HistoryManifest {
  protocolVersion: 2;
  earliestTimestamp: number;
  latestTimestamp: number;
  chunkDurationMs: number;
  chunkRanges?: [number, number][];
  cellSize: number;
  activityBucketMs?: number;
  activityReady?: boolean;
  capabilities: Record<string, boolean>;
  registry: HistoryRegistry;
}

export interface LiveSnapshot {
  protocolVersion: 2;
  generatedAt: number;
  registry: HistoryRegistry;
  points: HistoryPoint[];
  events: HistoryEvent[];
}

export interface IntegrationMapping {
  mapWorlds: Record<string, string>;
}

export interface ChatMessageRecord {
  web?: boolean;
  name: string;
  message: string;
}

export interface ChatSession {
  linked: boolean;
  name?: string;
}

export interface ChatFeed {
  messages: ChatMessageRecord[];
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  headers?: Pick<Headers, "get">;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<FetchResponse>;
export type PointSegment = HistoryPoint[];
export type PlayerState = JsonObject;
