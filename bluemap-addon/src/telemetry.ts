import { parseStateRecords } from "./protocol.js";
import type {
  Fetcher,
  HistoryPoint,
  HistoryRegistry,
  JsonObject,
  JsonValue,
  PlayerState,
  StateRecord,
} from "./types.js";

export const stateAt = (
  records: StateRecord[],
  player: number,
  time: number,
): PlayerState | null => {
  let end = records.length;
  while (end > 0 && (records[end - 1]?.time ?? Infinity) > time) end--;
  let start = end - 1;
  while (start >= 0) {
    const record = records[start];
    if (record?.player === player && (record.kind === "checkpoint" || record.kind === "unknown"))
      break;
    start--;
  }
  const initial = records[start];
  if (!initial || initial.kind === "unknown") return null;
  const state: PlayerState = { ...initial.values };
  for (let index = start + 1; index < end; index++) {
    const record = records[index];
    if (record?.player === player && record.kind === "delta") Object.assign(state, record.values);
  }
  return state;
};

export interface WorldHit {
  x: number;
  y: number;
  z: number;
}

export const trailPoint = (
  points: HistoryPoint[],
  index: number,
  hit?: WorldHit | null,
): HistoryPoint | null => {
  if (!Number.isInteger(index) || !hit) return null;
  const from = points[index];
  const to = points[index + 1];
  if (
    !from ||
    !to ||
    from.player !== to.player ||
    from.world !== to.world ||
    to.time < from.time ||
    to.flags & 1 ||
    from.flags & 2
  )
    return null;
  const delta = [to.x - from.x, to.y - from.y, to.z - from.z] as const;
  const length = delta.reduce((sum, value) => sum + value * value, 0);
  const offset = [hit.x * 32 - from.x, hit.y * 32 - from.y, hit.z * 32 - from.z] as const;
  const fraction = length
    ? Math.max(
        0,
        Math.min(1, delta.reduce((sum, value, i) => sum + value * (offset[i] ?? 0), 0) / length),
      )
    : 0;
  return {
    ...from,
    time: from.time + (to.time - from.time) * fraction,
    x: from.x + delta[0] * fraction,
    y: from.y + delta[1] * fraction,
    z: from.z + delta[2] * fraction,
  };
};

export class TelemetryCache {
  readonly chunks = new Map<number, Promise<StateRecord[]>>();
  readonly expires = new Map<number, number>();
  private readonly players = new WeakMap<StateRecord[], Map<number, StateRecord[]>>();
  private readonly fetcher: Fetcher;

  constructor(
    readonly base: URL,
    readonly duration: number,
    fetcher: Fetcher = (...args) => fetch(...args),
  ) {
    this.fetcher = fetcher;
  }

  async load(time: number): Promise<StateRecord[]> {
    const start = Math.floor(time / this.duration) * this.duration;
    if ((this.expires.get(start) ?? 0) < Date.now()) this.chunks.delete(start);
    if (!this.chunks.has(start)) {
      this.expires.set(start, Date.now() + 5_000);
      const promise = this.fetcher(new URL(`data/states/${start}.json`, this.base), {
        cache: "no-store",
      })
        .then(async (response) => {
          if (response.status === 404) return [];
          if (!response.ok) throw new Error("State history unavailable");
          if (!response.json) throw new Error("State history response is not JSON");
          return parseStateRecords(await response.json())
            .filter((record) => record.time >= start && record.time < start + this.duration)
            .sort((left, right) => left.time - right.time);
        })
        .catch(() => []);
      this.chunks.set(start, promise);
      while (this.chunks.size > 4) {
        const oldest = this.chunks.keys().next().value;
        if (oldest === undefined) break;
        this.chunks.delete(oldest);
        this.expires.delete(oldest);
      }
    }
    return this.chunks.get(start) ?? [];
  }

  async at(player: number, time: number): Promise<PlayerState | null> {
    const records = await this.load(time);
    let byPlayer = this.players.get(records);
    if (!byPlayer) {
      byPlayer = new Map<number, StateRecord[]>();
      for (const record of records) {
        const playerRecords = byPlayer.get(record.player) ?? [];
        playerRecords.push(record);
        byPlayer.set(record.player, playerRecords);
      }
      this.players.set(records, byPlayer);
    }
    return stateAt(byPlayer.get(player) ?? [], player, time);
  }
}

const formatValue = (value: JsonValue | undefined): string => {
  if (value == null) return "unknown";
  if (typeof value === "number") return String(Number(value.toFixed(1)));
  return String(value);
};

const asObject = (value: JsonValue | undefined): JsonObject | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null;

const describeItem = (value: JsonValue | undefined, registry: HistoryRegistry): string => {
  const item = asObject(value);
  if (!item) return "unknown";
  if (item.count === 0) return "empty";
  const id = typeof item.item === "number" ? item.item : -1;
  const name = registry.items.find((candidate) => candidate.id === id)?.key ?? "unknown item";
  const count = typeof item.count === "number" ? item.count : 1;
  const customName = typeof item.name === "string" ? ` · ${item.name}` : "";
  return `${readableName(name)} ×${count}${customName}`;
};

export const describeState = (
  state: PlayerState | null,
  registry: HistoryRegistry,
  capabilities: Record<string, boolean> = {},
): string => {
  if (!state) return "\nNo state recorded at this time";
  const lines: string[] = [];
  const fields = [
    ["health", "health", "♥ Health"],
    ["food", "food", "◆ Food"],
    ["xp", "xpLevel", "✦ XP level"],
    ["game-mode", "gameMode", "Game mode"],
  ] as const;
  for (const [capability, key, label] of fields) {
    if (!capabilities[capability]) continue;
    const maximum =
      key === "health" && state.maxHealth != null ? ` / ${formatValue(state.maxHealth)}` : "";
    lines.push(`${label}: ${formatValue(state[key])}${maximum}`);
  }
  if (capabilities["held-item"]) lines.push(`⛏ Held: ${describeItem(state.heldItem, registry)}`);
  if (capabilities.equipment) {
    for (const slot of ["head", "chest", "legs", "feet", "offhand"]) {
      lines.push(`▣ ${readableName(slot)}: ${describeItem(state[`equipment:${slot}`], registry)}`);
    }
  }
  if (capabilities.effects) {
    const effects = asObject(state.effects);
    const labels = effects
      ? Object.entries(effects).map(([key, value]) => {
          const effect = asObject(value);
          const amplifier = typeof effect?.amplifier === "number" ? effect.amplifier + 1 : 1;
          return `${readableName(key)} ${amplifier}`;
        })
      : null;
    lines.push(`✦ Effects: ${labels ? labels.join(", ") || "none" : "unknown"}`);
  }
  if (capabilities.inventory) {
    const slots = Object.entries(state).filter(([key]) => key.startsWith("slot:"));
    const inventory = slots.map(
      ([key, value]) => `${key.slice(5)}: ${describeItem(value, registry)}`,
    );
    lines.push(`▦ Inventory: ${inventory.join("; ") || "unknown"}`);
  }
  return lines.length ? `\n${lines.join("\n")}` : "";
};

export const readableName = (value: unknown): string =>
  String(value)
    .replace(/^minecraft:/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

export const chatMessage = (type: string, name: string, payload: JsonObject = {}): string => {
  const message = typeof payload.message === "string" ? payload.message : "";
  if (type === "CHAT") return `${name}: ${message}`;
  if (type === "JOIN") return `${name} joined the game`;
  if (type === "QUIT") return `${name} left the game`;
  if (type === "DEATH") return message || `${name} died`;
  return message;
};

const EVENT_FIELDS: Record<string, readonly string[]> = {
  TELEPORT: ["from", "to"],
  DIMENSION_CHANGE: ["from", "to"],
  BLOCK_BREAK: ["block"],
  BLOCK_PLACE: ["block"],
  CONTAINER_OPEN: ["menuType"],
  DAMAGE_TAKEN: ["source", "amount", "healthAfter"],
  DAMAGE_DEALT: ["targetType", "source", "amount", "healthAfter"],
  MOB_KILL: ["targetType"],
  PLAYER_KILL: ["targetType"],
  ADVANCEMENT: ["advancement"],
  CRAFT: ["item", "count", "name", "enchantments"],
  SMELT: ["item", "count", "name", "enchantments"],
  ENCHANT: ["item", "count", "name", "enchantments"],
  TRADE: ["item", "count", "name", "enchantments"],
  ITEM_PICKUP: ["item", "count", "name", "enchantments"],
  ITEM_DROP: ["item", "count", "name", "enchantments"],
};

const parsePayload = (payload: JsonObject | string): JsonObject | null => {
  if (typeof payload !== "string") return payload;
  try {
    const value: unknown = JSON.parse(payload);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonObject)
      : null;
  } catch {
    return null;
  }
};

const isCoordinate = (value: JsonObject): boolean =>
  [value.x, value.y, value.z, value.world].every((field) => typeof field === "number");

export const eventDetails = (
  input: JsonObject | string,
  registry: Partial<HistoryRegistry> = {},
  type?: string,
): string => {
  const payload = parsePayload(input);
  if (!payload) return typeof input === "string" && input.trim() ? "Details unavailable" : "";
  if (type === "JOIN") return "Joined the game";
  if (type === "QUIT") return "Left the game";
  if (type === "RESPAWN") return "Respawned";
  if (type === "DEATH") return typeof payload.message === "string" ? payload.message : "Died";
  if (type === "CHAT")
    return typeof payload.message === "string" ? payload.message : "Chat message";
  const fields = type ? EVENT_FIELDS[type] : undefined;
  const details: JsonObject = fields
    ? Object.fromEntries(
        fields.flatMap((key) => {
          const value = payload[key];
          return value == null ? [] : [[key, value]];
        }),
      )
    : payload;
  const lines: string[] = [];
  const visit = (value: JsonValue, label: string, depth = 0): void => {
    if (depth > 3 || lines.length >= 24 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        visit(item, `${label} ${index + 1}`, depth + 1);
      });
      return;
    }
    if (typeof value === "object") {
      if (isCoordinate(value)) {
        const world = typeof value.world === "number" ? value.world : -1;
        const dimension = registry.worlds?.find((candidate) => candidate.id === world)?.key;
        const coordinates = [value.x, value.y, value.z]
          .map((coordinate) => ((coordinate as number) / 32).toFixed(1))
          .join(", ");
        lines.push(`${label}: ${coordinates}${dimension ? ` · ${readableName(dimension)}` : ""}`);
        return;
      }
      for (const [key, item] of Object.entries(value)) {
        if (key.toLowerCase() === "damage") continue;
        visit(item, label ? `${label} · ${readableName(key)}` : readableName(key), depth + 1);
      }
      return;
    }
    if (label === "Details Truncated") {
      lines.push("Some details were too large to record");
      return;
    }
    let formatted: JsonValue = value;
    if (label === "Item" && typeof value === "number") {
      formatted =
        registry.items?.find((item) => item.id === value)?.key ??
        (value === 0 ? "Empty" : "Unknown item");
    }
    const display =
      typeof formatted === "boolean"
        ? formatted
          ? "Yes"
          : "No"
        : typeof formatted === "number"
          ? Number(formatted.toFixed(2))
          : readableName(formatted);
    lines.push(`${label}: ${display}`);
  };
  visit(details, "");
  return lines.join("\n");
};
