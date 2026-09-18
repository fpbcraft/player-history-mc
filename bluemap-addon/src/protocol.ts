import type {
  ChatFeed,
  ChatSession,
  HistoryChunk,
  HistoryEvent,
  HistoryManifest,
  HistoryPoint,
  HistoryRegistry,
  IntegrationMapping,
  JsonObject,
  LiveSnapshot,
  ObjectHistoryManifest,
  ObjectHistoryPoint,
  ObjectHistoryRegistry,
  StateRecord,
} from "./types.js";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberField = (value: Record<string, unknown>, key: string): number => {
  const result = value[key];
  if (!Number.isFinite(result)) throw new Error(`Invalid ${key}`);
  return result as number;
};

const stringField = (value: Record<string, unknown>, key: string): string => {
  const result = value[key];
  if (typeof result !== "string") throw new Error(`Invalid ${key}`);
  return result;
};

export const parsePoint = (value: unknown): HistoryPoint => {
  if (!isObject(value)) throw new Error("Invalid history point");
  return {
    player: numberField(value, "player"),
    time: numberField(value, "time"),
    world: numberField(value, "world"),
    x: numberField(value, "x"),
    y: numberField(value, "y"),
    z: numberField(value, "z"),
    flags: numberField(value, "flags"),
  };
};

export const parseEvent = (value: unknown): HistoryEvent => {
  if (!isObject(value)) throw new Error("Invalid history event");
  const payload = value.payload;
  if (typeof payload !== "string" && !isObject(payload)) {
    throw new Error("Invalid event payload");
  }
  return {
    point: parsePoint(value.point),
    type: stringField(value, "type"),
    payload: payload as JsonObject | string,
  };
};

const parseRegistry = (value: unknown): HistoryRegistry => {
  if (!isObject(value)) throw new Error("Invalid registry");
  const players = Array.isArray(value.players) ? value.players : [];
  const worlds = Array.isArray(value.worlds) ? value.worlds : [];
  const items = Array.isArray(value.items) ? value.items : [];
  return {
    players: players.map((player) => {
      if (!isObject(player)) throw new Error("Invalid player registry");
      return {
        id: numberField(player, "id"),
        uuid: stringField(player, "uuid"),
        name: stringField(player, "name"),
      };
    }),
    worlds: worlds.map((world) => {
      if (!isObject(world)) throw new Error("Invalid world registry");
      return { id: numberField(world, "id"), key: stringField(world, "key") };
    }),
    items: items.map((item) => {
      if (!isObject(item)) throw new Error("Invalid item registry");
      return { id: numberField(item, "id"), key: stringField(item, "key") };
    }),
  };
};

const parseCapabilities = (value: unknown): Record<string, boolean> => {
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  );
};

export const parseManifest = (value: unknown): HistoryManifest => {
  if (!isObject(value) || value.protocolVersion !== 2) {
    throw new Error("Unsupported history version");
  }
  const earliestTimestamp = numberField(value, "earliestTimestamp");
  const latestTimestamp = numberField(value, "latestTimestamp");
  const chunkDurationMs = numberField(value, "chunkDurationMs");
  if (latestTimestamp < earliestTimestamp || latestTimestamp <= 0 || chunkDurationMs <= 0) {
    throw new Error("No recorded history yet.");
  }
  const result: HistoryManifest = {
    protocolVersion: 2,
    earliestTimestamp,
    latestTimestamp,
    chunkDurationMs,
    cellSize: Number.isFinite(value.cellSize) ? (value.cellSize as number) : 1,
    capabilities: parseCapabilities(value.capabilities),
    registry: parseRegistry(value.registry),
  };
  if (value.chunkRanges !== undefined) {
    if (!Array.isArray(value.chunkRanges) || value.chunkRanges.length > 100_000)
      throw new Error("Invalid history chunk index");
    result.chunkRanges = value.chunkRanges.map((range): [number, number] => {
      if (
        !Array.isArray(range) ||
        range.length !== 2 ||
        !range.every(Number.isFinite) ||
        range[0] >= range[1] ||
        range[0] % chunkDurationMs !== 0 ||
        range[1] % chunkDurationMs !== 0
      )
        throw new Error("Invalid history chunk range");
      return [range[0], range[1]];
    });
    for (let index = 1; index < result.chunkRanges.length; index++) {
      const previous = result.chunkRanges[index - 1];
      const current = result.chunkRanges[index];
      if (!previous || !current || current[0] < previous[1])
        throw new Error("History chunk ranges are not sorted");
    }
  }
  if (Number.isFinite(value.activityBucketMs))
    result.activityBucketMs = value.activityBucketMs as number;
  if (typeof value.activityReady === "boolean") result.activityReady = value.activityReady;
  return result;
};

export const parseChunk = (value: unknown): HistoryChunk => {
  if (!isObject(value) || !Array.isArray(value.points) || !Array.isArray(value.events)) {
    throw new Error("Invalid history chunk");
  }
  if (value.points.length > 1_000_000 || value.events.length > 200_000) {
    throw new Error("Oversized history chunk");
  }
  return { points: value.points.map(parsePoint), events: value.events.map(parseEvent) };
};

export const parseStateRecords = (value: unknown): StateRecord[] => {
  if (!Array.isArray(value) || value.length > 100_000) throw new Error("Invalid state chunk");
  return value.map((record) => {
    if (!isObject(record) || !["checkpoint", "delta", "unknown"].includes(String(record.kind))) {
      throw new Error("Invalid state record");
    }
    return {
      player: numberField(record, "player"),
      time: numberField(record, "time"),
      kind: record.kind as StateRecord["kind"],
      values: isObject(record.values) ? (record.values as JsonObject) : {},
    };
  });
};

export const parseLiveSnapshot = (value: unknown): LiveSnapshot => {
  if (!isObject(value) || value.protocolVersion !== 2) throw new Error("Invalid live snapshot");
  return {
    protocolVersion: 2,
    generatedAt: numberField(value, "generatedAt"),
    registry: parseRegistry(value.registry),
    points: Array.isArray(value.points) ? value.points.slice(-20_000).map(parsePoint) : [],
    events: Array.isArray(value.events) ? value.events.slice(-1_000).map(parseEvent) : [],
  };
};

export const parseObjectPoint = (value: unknown): ObjectHistoryPoint => {
  if (!isObject(value)) throw new Error("Invalid object-history point");
  return {
    object: numberField(value, "object"),
    time: numberField(value, "time"),
    world: numberField(value, "world"),
    x: numberField(value, "x"),
    y: numberField(value, "y"),
    z: numberField(value, "z"),
    qx: numberField(value, "qx"),
    qy: numberField(value, "qy"),
    qz: numberField(value, "qz"),
    qw: numberField(value, "qw"),
    geometry: numberField(value, "geometry"),
    flags: numberField(value, "flags"),
  };
};

const parseObjectRegistry = (value: unknown): ObjectHistoryRegistry => {
  if (!isObject(value)) throw new Error("Invalid object-history registry");
  const objects = Array.isArray(value.objects) ? value.objects : [];
  const worlds = Array.isArray(value.worlds) ? value.worlds : [];
  return {
    objects: objects.map((entry) => {
      if (!isObject(entry)) throw new Error("Invalid object registry entry");
      return {
        id: numberField(entry, "id"),
        provider: stringField(entry, "provider"),
        sourceId: stringField(entry, "sourceId"),
        label: stringField(entry, "label"),
      };
    }),
    worlds: worlds.map((world) => {
      if (typeof world !== "string") throw new Error("Invalid object-history world");
      return world;
    }),
  };
};

export const parseObjectManifest = (value: unknown): ObjectHistoryManifest => {
  if (!isObject(value) || value.protocolVersion !== 1)
    throw new Error("Unsupported object-history version");
  const earliestTimestamp = numberField(value, "earliestTimestamp");
  const latestTimestamp = numberField(value, "latestTimestamp");
  const chunkDurationMs = numberField(value, "chunkDurationMs");
  const positionScale = numberField(value, "positionScale");
  const quaternionScale = numberField(value, "quaternionScale");
  if (
    latestTimestamp < earliestTimestamp ||
    latestTimestamp <= 0 ||
    chunkDurationMs <= 0 ||
    positionScale <= 0 ||
    quaternionScale <= 0
  )
    throw new Error("Invalid object-history manifest");
  const result: ObjectHistoryManifest = {
    protocolVersion: 1,
    earliestTimestamp,
    latestTimestamp,
    chunkDurationMs,
    positionScale,
    quaternionScale,
    geometryArchive: value.geometryArchive === true,
    registry: parseObjectRegistry(value.registry),
  };
  if (value.chunkRanges !== undefined) {
    if (!Array.isArray(value.chunkRanges) || value.chunkRanges.length > 100_000)
      throw new Error("Invalid object-history chunk index");
    result.chunkRanges = value.chunkRanges.map((range): [number, number] => {
      if (
        !Array.isArray(range) ||
        range.length !== 2 ||
        !range.every(Number.isFinite) ||
        range[0] >= range[1] ||
        range[0] % chunkDurationMs !== 0 ||
        range[1] % chunkDurationMs !== 0
      )
        throw new Error("Invalid object-history chunk range");
      return [range[0], range[1]];
    });
  }
  return result;
};

export const parseObjectChunk = (value: unknown): ObjectHistoryPoint[] => {
  if (!Array.isArray(value) || value.length > 1_000_000)
    throw new Error("Invalid object-history chunk");
  return value.map(parseObjectPoint);
};

export const parseIntegration = (value: unknown): IntegrationMapping => {
  if (!isObject(value) || !isObject(value.mapWorlds))
    throw new Error("Invalid BlueMap integration mapping");
  return {
    mapWorlds: Object.fromEntries(
      Object.entries(value.mapWorlds).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  };
};

export const parseChatSession = (value: unknown): ChatSession => {
  if (!isObject(value) || typeof value.linked !== "boolean")
    throw new Error("Invalid chat session");
  return { linked: value.linked, ...(typeof value.name === "string" ? { name: value.name } : {}) };
};

export const parseChatFeed = (value: unknown): ChatFeed => {
  if (!isObject(value) || !Array.isArray(value.messages)) throw new Error("Invalid chat feed");
  return {
    messages: value.messages.flatMap((message) => {
      if (
        !isObject(message) ||
        typeof message.name !== "string" ||
        typeof message.message !== "string"
      )
        return [];
      return [
        {
          name: message.name,
          message: message.message,
          ...(typeof message.web === "boolean" ? { web: message.web } : {}),
        },
      ];
    }),
  };
};
