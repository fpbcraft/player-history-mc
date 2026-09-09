"use strict";
(() => {
  // src/event-presentation.ts
  var EVENT_TYPES = [
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
    "ITEM_DROP"
  ];
  var playerColor = (id) => `hsl(${(id * 137.508 + 195) % 360}, 78%, 65%)`;
  var eventColor = (type) => {
    const index = EVENT_TYPES.indexOf(type);
    const hue = index >= 0 ? index * 137.508 % 360 : [...type].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) % 360, 0);
    return `hsl(${hue}, 82%, 66%)`;
  };
  var FALLBACK_HEAD = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><path fill="#b68763" d="M0 0h8v8H0z"/><path fill="#493222" d="M0 0h8v2H0zM0 2h1v1H0zM7 2h1v1H7z"/><path fill="#fff" d="M1 4h2v1H1zM5 4h2v1H5z"/><path fill="#524b88" d="M2 4h1v1H2zM5 4h1v1H5z"/><path fill="#68452f" d="M2 6h4v2H2z"/><path fill="#b68763" d="M3 6h2v1H3z"/></svg>'
  )}`;
  var formatTimestamp = (time) => new Date(time).toLocaleString();
  var formatShortTimestamp = (time) => new Date(time).toLocaleTimeString(void 0, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  var formatCoordinates = (point) => [point.x, point.y, point.z].map((value) => (value / 32).toFixed(1)).join(", ");
  var EVENT_PATHS = {
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
    QUIT: "M10 3H3v18h7m0-9h11m-4-4 4 4-4 4"
  };
  var createEventIcon = (type) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", EVENT_PATHS[type] ?? "M5 5h14v14H5zM8 12h8m-4-4v8");
    svg.append(path);
    return svg;
  };

  // src/player-vitals.ts
  var meterLevels = (value, maximum, limit = 20) => {
    if (typeof value !== "number" || typeof maximum !== "number" || maximum <= 0) return [];
    const slots = Math.max(1, Math.min(limit, Math.ceil(maximum / 2)));
    return Array.from({ length: slots }, (_2, index) => {
      const remaining = Math.max(0, Math.min(2, value - index * 2));
      return remaining >= 2 ? "full" : remaining > 0 ? "half" : "empty";
    });
  };
  var createVitals = () => {
    const vitals = document.createElement("div");
    vitals.className = "history-player-vitals";
    vitals.hidden = true;
    const health = document.createElement("div");
    health.className = "history-vital-row history-health-hearts";
    health.setAttribute("aria-label", "Health");
    vitals.append(health);
    return vitals;
  };
  var renderVitals = (vitals, state = {}) => {
    const healthRow = vitals?.querySelector(".history-health-hearts");
    if (!vitals || !healthRow) return;
    healthRow.replaceChildren();
    const health = meterLevels(state.health, state.maxHealth);
    for (const level of health) {
      const icon = document.createElement("i");
      icon.className = `heart ${level}`;
      healthRow.append(icon);
    }
    healthRow.setAttribute(
      "aria-label",
      health.length ? `Health ${String(state.health)} of ${String(state.maxHealth)}` : "Health unknown"
    );
    vitals.hidden = health.length === 0;
  };

  // src/protocol.ts
  var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  var numberField = (value, key) => {
    const result = value[key];
    if (!Number.isFinite(result)) throw new Error(`Invalid ${key}`);
    return result;
  };
  var stringField = (value, key) => {
    const result = value[key];
    if (typeof result !== "string") throw new Error(`Invalid ${key}`);
    return result;
  };
  var parsePoint = (value) => {
    if (!isObject(value)) throw new Error("Invalid history point");
    return {
      player: numberField(value, "player"),
      time: numberField(value, "time"),
      world: numberField(value, "world"),
      x: numberField(value, "x"),
      y: numberField(value, "y"),
      z: numberField(value, "z"),
      flags: numberField(value, "flags")
    };
  };
  var parseEvent = (value) => {
    if (!isObject(value)) throw new Error("Invalid history event");
    const payload = value.payload;
    if (typeof payload !== "string" && !isObject(payload)) {
      throw new Error("Invalid event payload");
    }
    return {
      point: parsePoint(value.point),
      type: stringField(value, "type"),
      payload
    };
  };
  var parseRegistry = (value) => {
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
          name: stringField(player, "name")
        };
      }),
      worlds: worlds.map((world) => {
        if (!isObject(world)) throw new Error("Invalid world registry");
        return { id: numberField(world, "id"), key: stringField(world, "key") };
      }),
      items: items.map((item) => {
        if (!isObject(item)) throw new Error("Invalid item registry");
        return { id: numberField(item, "id"), key: stringField(item, "key") };
      })
    };
  };
  var parseCapabilities = (value) => {
    if (!isObject(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry) => typeof entry[1] === "boolean"
      )
    );
  };
  var parseManifest = (value) => {
    if (!isObject(value) || value.protocolVersion !== 2) {
      throw new Error("Unsupported history version");
    }
    const earliestTimestamp = numberField(value, "earliestTimestamp");
    const latestTimestamp = numberField(value, "latestTimestamp");
    const chunkDurationMs = numberField(value, "chunkDurationMs");
    if (latestTimestamp < earliestTimestamp || latestTimestamp <= 0 || chunkDurationMs <= 0) {
      throw new Error("No recorded history yet.");
    }
    const result = {
      protocolVersion: 2,
      earliestTimestamp,
      latestTimestamp,
      chunkDurationMs,
      cellSize: Number.isFinite(value.cellSize) ? value.cellSize : 1,
      capabilities: parseCapabilities(value.capabilities),
      registry: parseRegistry(value.registry)
    };
    if (value.chunkRanges !== void 0) {
      if (!Array.isArray(value.chunkRanges) || value.chunkRanges.length > 1e5)
        throw new Error("Invalid history chunk index");
      result.chunkRanges = value.chunkRanges.map((range) => {
        if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] >= range[1] || range[0] % chunkDurationMs !== 0 || range[1] % chunkDurationMs !== 0)
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
      result.activityBucketMs = value.activityBucketMs;
    if (typeof value.activityReady === "boolean") result.activityReady = value.activityReady;
    return result;
  };
  var parseChunk = (value) => {
    if (!isObject(value) || !Array.isArray(value.points) || !Array.isArray(value.events)) {
      throw new Error("Invalid history chunk");
    }
    if (value.points.length > 1e6 || value.events.length > 2e5) {
      throw new Error("Oversized history chunk");
    }
    return { points: value.points.map(parsePoint), events: value.events.map(parseEvent) };
  };
  var parseStateRecords = (value) => {
    if (!Array.isArray(value) || value.length > 1e5) throw new Error("Invalid state chunk");
    return value.map((record) => {
      if (!isObject(record) || !["checkpoint", "delta", "unknown"].includes(String(record.kind))) {
        throw new Error("Invalid state record");
      }
      return {
        player: numberField(record, "player"),
        time: numberField(record, "time"),
        kind: record.kind,
        values: isObject(record.values) ? record.values : {}
      };
    });
  };
  var parseLiveSnapshot = (value) => {
    if (!isObject(value) || value.protocolVersion !== 2) throw new Error("Invalid live snapshot");
    return {
      protocolVersion: 2,
      generatedAt: numberField(value, "generatedAt"),
      registry: parseRegistry(value.registry),
      points: Array.isArray(value.points) ? value.points.slice(-2e4).map(parsePoint) : [],
      events: Array.isArray(value.events) ? value.events.slice(-1e3).map(parseEvent) : []
    };
  };
  var parseIntegration = (value) => {
    if (!isObject(value) || !isObject(value.mapWorlds))
      throw new Error("Invalid BlueMap integration mapping");
    return {
      mapWorlds: Object.fromEntries(
        Object.entries(value.mapWorlds).filter(
          (entry) => typeof entry[1] === "string"
        )
      )
    };
  };
  var parseChatSession = (value) => {
    if (!isObject(value) || typeof value.linked !== "boolean")
      throw new Error("Invalid chat session");
    return { linked: value.linked, ...typeof value.name === "string" ? { name: value.name } : {} };
  };
  var parseChatFeed = (value) => {
    if (!isObject(value) || !Array.isArray(value.messages)) throw new Error("Invalid chat feed");
    return {
      messages: value.messages.flatMap((message) => {
        if (!isObject(message) || typeof message.name !== "string" || typeof message.message !== "string")
          return [];
        return [
          {
            name: message.name,
            message: message.message,
            ...typeof message.web === "boolean" ? { web: message.web } : {}
          }
        ];
      })
    };
  };

  // src/telemetry.ts
  var stateAt = (records, player, time) => {
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
    const state = { ...initial.values };
    for (let index = start + 1; index < end; index++) {
      const record = records[index];
      if (record?.player === player && record.kind === "delta") Object.assign(state, record.values);
    }
    return state;
  };
  var trailPoint = (points, index, hit) => {
    if (!Number.isInteger(index) || !hit) return null;
    const from = points[index];
    const to = points[index + 1];
    if (!from || !to || from.player !== to.player || from.world !== to.world || to.time < from.time || to.flags & 1 || from.flags & 2)
      return null;
    const delta = [to.x - from.x, to.y - from.y, to.z - from.z];
    const length = delta.reduce((sum, value) => sum + value * value, 0);
    const offset = [hit.x * 32 - from.x, hit.y * 32 - from.y, hit.z * 32 - from.z];
    const fraction = length ? Math.max(
      0,
      Math.min(1, delta.reduce((sum, value, i2) => sum + value * (offset[i2] ?? 0), 0) / length)
    ) : 0;
    return {
      ...from,
      time: from.time + (to.time - from.time) * fraction,
      x: from.x + delta[0] * fraction,
      y: from.y + delta[1] * fraction,
      z: from.z + delta[2] * fraction
    };
  };
  var TelemetryCache = class {
    constructor(base, duration, fetcher = (...args) => fetch(...args)) {
      this.base = base;
      this.duration = duration;
      this.fetcher = fetcher;
    }
    base;
    duration;
    chunks = /* @__PURE__ */ new Map();
    expires = /* @__PURE__ */ new Map();
    players = /* @__PURE__ */ new WeakMap();
    fetcher;
    async load(time) {
      const start = Math.floor(time / this.duration) * this.duration;
      if ((this.expires.get(start) ?? 0) < Date.now()) this.chunks.delete(start);
      if (!this.chunks.has(start)) {
        this.expires.set(start, Date.now() + 5e3);
        const promise = this.fetcher(new URL(`data/states/${start}.json`, this.base), {
          cache: "no-store"
        }).then(async (response) => {
          if (response.status === 404) return [];
          if (!response.ok) throw new Error("State history unavailable");
          if (!response.json) throw new Error("State history response is not JSON");
          return parseStateRecords(await response.json()).filter((record) => record.time >= start && record.time < start + this.duration).sort((left, right) => left.time - right.time);
        }).catch(() => []);
        this.chunks.set(start, promise);
        while (this.chunks.size > 4) {
          const oldest = this.chunks.keys().next().value;
          if (oldest === void 0) break;
          this.chunks.delete(oldest);
          this.expires.delete(oldest);
        }
      }
      return this.chunks.get(start) ?? [];
    }
    async at(player, time) {
      const records = await this.load(time);
      let byPlayer = this.players.get(records);
      if (!byPlayer) {
        byPlayer = /* @__PURE__ */ new Map();
        for (const record of records) {
          const playerRecords = byPlayer.get(record.player) ?? [];
          playerRecords.push(record);
          byPlayer.set(record.player, playerRecords);
        }
        this.players.set(records, byPlayer);
      }
      return stateAt(byPlayer.get(player) ?? [], player, time);
    }
  };
  var formatValue = (value) => {
    if (value == null) return "unknown";
    if (typeof value === "number") return String(Number(value.toFixed(1)));
    return String(value);
  };
  var asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
  var describeItem = (value, registry) => {
    const item = asObject(value);
    if (!item) return "unknown";
    if (item.count === 0) return "empty";
    const id = typeof item.item === "number" ? item.item : -1;
    const name = registry.items.find((candidate) => candidate.id === id)?.key ?? "unknown item";
    const count = typeof item.count === "number" ? item.count : 1;
    const customName = typeof item.name === "string" ? ` \xB7 ${item.name}` : "";
    return `${readableName(name)} \xD7${count}${customName}`;
  };
  var describeState = (state, registry, capabilities = {}) => {
    if (!state) return "\nNo state recorded at this time";
    const lines = [];
    const fields = [
      ["health", "health", "\u2665 Health"],
      ["food", "food", "\u25C6 Food"],
      ["xp", "xpLevel", "\u2726 XP level"],
      ["game-mode", "gameMode", "Game mode"]
    ];
    for (const [capability, key, label] of fields) {
      if (!capabilities[capability]) continue;
      const maximum = key === "health" && state.maxHealth != null ? ` / ${formatValue(state.maxHealth)}` : "";
      lines.push(`${label}: ${formatValue(state[key])}${maximum}`);
    }
    if (capabilities["held-item"]) lines.push(`\u26CF Held: ${describeItem(state.heldItem, registry)}`);
    if (capabilities.equipment) {
      for (const slot of ["head", "chest", "legs", "feet", "offhand"]) {
        lines.push(`\u25A3 ${readableName(slot)}: ${describeItem(state[`equipment:${slot}`], registry)}`);
      }
    }
    if (capabilities.effects) {
      const effects = asObject(state.effects);
      const labels = effects ? Object.entries(effects).map(([key, value]) => {
        const effect = asObject(value);
        const amplifier = typeof effect?.amplifier === "number" ? effect.amplifier + 1 : 1;
        return `${readableName(key)} ${amplifier}`;
      }) : null;
      lines.push(`\u2726 Effects: ${labels ? labels.join(", ") || "none" : "unknown"}`);
    }
    if (capabilities.inventory) {
      const slots = Object.entries(state).filter(([key]) => key.startsWith("slot:"));
      const inventory = slots.map(
        ([key, value]) => `${key.slice(5)}: ${describeItem(value, registry)}`
      );
      lines.push(`\u25A6 Inventory: ${inventory.join("; ") || "unknown"}`);
    }
    return lines.length ? `
${lines.join("\n")}` : "";
  };
  var readableName = (value) => String(value).replace(/^minecraft:/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
  var chatMessage = (type, name, payload = {}) => {
    const message = typeof payload.message === "string" ? payload.message : "";
    if (type === "CHAT") return `${name}: ${message}`;
    if (type === "JOIN") return `${name} joined the game`;
    if (type === "QUIT") return `${name} left the game`;
    if (type === "DEATH") return message || `${name} died`;
    return message;
  };
  var EVENT_FIELDS = {
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
    ITEM_DROP: ["item", "count", "name", "enchantments"]
  };
  var parsePayload = (payload) => {
    if (typeof payload !== "string") return payload;
    try {
      const value = JSON.parse(payload);
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  };
  var isCoordinate = (value) => [value.x, value.y, value.z, value.world].every((field) => typeof field === "number");
  var eventDetails = (input, registry = {}, type) => {
    const payload = parsePayload(input);
    if (!payload) return typeof input === "string" && input.trim() ? "Details unavailable" : "";
    if (type === "JOIN") return "Joined the game";
    if (type === "QUIT") return "Left the game";
    if (type === "RESPAWN") return "Respawned";
    if (type === "DEATH") return typeof payload.message === "string" ? payload.message : "Died";
    const fields = type ? EVENT_FIELDS[type] : void 0;
    const details = fields ? Object.fromEntries(
      fields.flatMap((key) => {
        const value = payload[key];
        return value == null ? [] : [[key, value]];
      })
    ) : payload;
    const lines = [];
    const visit = (value, label, depth = 0) => {
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
          const coordinates = [value.x, value.y, value.z].map((coordinate) => (coordinate / 32).toFixed(1)).join(", ");
          lines.push(`${label}: ${coordinates}${dimension ? ` \xB7 ${readableName(dimension)}` : ""}`);
          return;
        }
        for (const [key, item] of Object.entries(value)) {
          if (key.toLowerCase() === "damage") continue;
          visit(item, label ? `${label} \xB7 ${readableName(key)}` : readableName(key), depth + 1);
        }
        return;
      }
      if (label === "Details Truncated") {
        lines.push("Some details were too large to record");
        return;
      }
      let formatted = value;
      if (label === "Item" && typeof value === "number") {
        formatted = registry.items?.find((item) => item.id === value)?.key ?? (value === 0 ? "Empty" : "Unknown item");
      }
      const display = typeof formatted === "boolean" ? formatted ? "Yes" : "No" : typeof formatted === "number" ? Number(formatted.toFixed(2)) : readableName(formatted);
      lines.push(`${label}: ${display}`);
    };
    visit(details, "");
    return lines.join("\n");
  };

  // src/bluemap-adapter.ts
  var closestElement = (target, selector) => {
    if (!target || typeof target.closest !== "function") return null;
    return target.closest(selector);
  };
  var BlueMapAdapter = class {
    app;
    api;
    root;
    players;
    trails;
    events;
    hoverDot;
    tooltip;
    hoverListeners;
    raycaster;
    eventMarkers = /* @__PURE__ */ new Map();
    nextEventId = 0;
    hoverActive = false;
    hoverFrame;
    hoverEvent;
    hoverState = null;
    hoverToken = {};
    expandedGroup = null;
    heat = null;
    stateDetails;
    constructor(app, api) {
      this.app = app;
      this.api = api;
      if (!api?.MarkerSet || !api?.HtmlMarker || !api?.Three || !app?.mapViewer?.markers)
        throw Error("Unsupported BlueMap web API");
      this.root = new api.MarkerSet("player-history-replay", {
        label: "Historical replay",
        toggleable: false
      });
      this.players = new api.MarkerSet("history-players", { toggleable: false });
      this.trails = new api.MarkerSet("history-trails", { toggleable: false });
      this.events = new api.MarkerSet("history-events", { toggleable: false });
      this.hoverDot = new api.HtmlMarker("history-hover-point");
      this.hoverDot.anchor.set(7, 7);
      this.hoverDot.element.className = "history-trail-dot";
      this.hoverDot.element.hidden = true;
      this.root.add(this.players, this.trails, this.events, this.hoverDot);
      app.popupMarkerSet.add(this.root);
      this.tooltip = document.createElement("div");
      this.tooltip.className = "history-map-tooltip";
      this.tooltip.setAttribute("role", "tooltip");
      this.tooltip.hidden = true;
      this.hoverDot.element.hidden = true;
      document.body.append(this.tooltip);
      this.hoverListeners = new AbortController();
      this.raycaster = new api.Three.Raycaster();
      this.raycaster.params.Line2 = { threshold: 6 };
      document.addEventListener(
        "click",
        (event) => {
          if (!closestElement(event.target, "bluemap-player-replay, button, input, select"))
            this.hover(event);
        },
        { signal: this.hoverListeners.signal }
      );
      document.addEventListener(
        "pointermove",
        (event) => {
          this.hoverEvent = event;
          this.hoverActive = true;
          if (!this.hoverFrame)
            this.hoverFrame = requestAnimationFrame(() => {
              this.hoverFrame = void 0;
              this.hover(this.hoverEvent);
            });
        },
        { signal: this.hoverListeners.signal }
      );
      document.addEventListener(
        "pointerdown",
        (event) => {
          if (this.expandedGroup && !closestElement(event.target, ".history-event-group"))
            this.collapseEventGroup();
          this.tooltip.hidden = true;
          this.hoverDot.element.hidden = true;
        },
        { signal: this.hoverListeners.signal }
      );
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape") {
            this.tooltip.hidden = true;
            this.hoverDot.element.hidden = true;
          }
        },
        { signal: this.hoverListeners.signal }
      );
      window.addEventListener(
        "blur",
        () => {
          this.tooltip.hidden = true;
          this.hoverDot.element.hidden = true;
        },
        { signal: this.hoverListeners.signal }
      );
      document.addEventListener(
        "pointerleave",
        () => {
          this.hoverActive = false;
          this.tooltip.hidden = true;
          this.hoverDot.element.hidden = true;
        },
        { signal: this.hoverListeners.signal }
      );
    }
    hover(event) {
      if (this.expandedGroup && !closestElement(event?.target, ".history-event-list-item")) {
        this.tooltip.hidden = true;
        this.hoverDot.element.hidden = true;
        return;
      }
      if (!event || event.buttons || event.pointerType === "touch") {
        this.tooltip.hidden = true;
        this.hoverDot.element.hidden = true;
        return;
      }
      this.hoverState = null;
      this.hoverDot.element.hidden = true;
      const annotation = closestElement(
        event.target,
        ".history-event-list-item, .history-event, .history-player"
      );
      let text = annotation?.dataset.historyTooltip;
      if (annotation?.dataset.player)
        this.hoverState = [Number(annotation.dataset.player), Number(annotation.dataset.time)];
      if (!text && !closestElement(event.target, "bluemap-player-replay, button, input, select")) {
        const viewer = this.app.mapViewer, bounds = viewer.renderer.domElement.getBoundingClientRect();
        const position = new this.api.Three.Vector2(
          (event.clientX - bounds.left) / bounds.width * 2 - 1,
          -(event.clientY - bounds.top) / bounds.height * 2 + 1
        );
        this.raycaster.setFromCamera(position, viewer.camera);
        const hit = this.raycaster.intersectObjects(
          this.trails.children.flatMap((marker) => marker.line ? [marker.line] : []),
          false
        )[0];
        if (hit) {
          const data = hit.object.userData;
          const point = trailPoint(
            data.historyPoints ?? [],
            hit.faceIndex,
            hit.pointOnLine ?? hit.point
          );
          if (point) {
            this.hoverDot.position.set(point.x / 32, point.y / 32, point.z / 32);
            this.hoverDot.element.style.background = playerColor(point.player);
            this.hoverDot.element.hidden = false;
            text = `${data.historyName} \xB7 Trail
${formatTimestamp(point.time)}
Position: ${formatCoordinates(point)}`;
            this.hoverState = [point.player, point.time];
          }
        }
      }
      this.tooltip.hidden = !text;
      if (text) {
        const head = annotation?.dataset?.historyHead;
        this.tooltip.className = `history-map-tooltip${head ? " with-player-head" : ""}`;
        this.tooltip.style.backgroundImage = head ? `url("${head}")` : "";
        this.tooltip.textContent = text;
        const token = {};
        this.hoverToken = token;
        if (this.hoverState && this.stateDetails)
          this.stateDetails(...this.hoverState).then((details) => {
            if (this.hoverToken === token && !this.tooltip.hidden)
              this.tooltip.textContent = text + details;
          });
        this.tooltip.style.left = `${Math.max(8, Math.min(event.clientX + 14, innerWidth - this.tooltip.offsetWidth - 8))}px`;
        this.tooltip.style.top = Math.max(8, Math.min(event.clientY + 14, innerHeight - this.tooltip.offsetHeight - 8)) + "px";
      }
    }
    focusTooltip(element) {
      element.onfocus = () => {
        const bounds = element.getBoundingClientRect();
        this.hover({
          target: element,
          clientX: bounds.right,
          clientY: bounds.top
        });
      };
      element.onblur = () => {
        this.tooltip.hidden = true;
        this.hoverDot.element.hidden = true;
      };
    }
    collapseEventGroup() {
      for (const marker of this.eventMarkers.values()) {
        marker.element.hidden = false;
        const list = marker.element.querySelector(".history-event-list");
        if (list) list.hidden = true;
        marker.element.classList?.remove("expanded");
        marker.element.setAttribute?.("aria-expanded", "false");
      }
      this.expandedGroup = null;
    }
    expandEventGroup(marker) {
      const list = marker.element.querySelector(".history-event-list");
      if (!list) return;
      if (this.expandedGroup === marker) {
        this.collapseEventGroup();
        return;
      }
      this.collapseEventGroup();
      this.expandedGroup = marker;
      if (this.tooltip) this.tooltip.hidden = true;
      if (this.hoverDot?.element) this.hoverDot.element.hidden = true;
      for (const other of this.eventMarkers.values()) other.element.hidden = other !== marker;
      const bounds = marker.element.getBoundingClientRect?.();
      list.classList?.toggle("align-left", Boolean(bounds && bounds.left > innerWidth / 2));
      list.hidden = false;
      marker.element.classList.add("expanded");
      marker.element.setAttribute("aria-expanded", "true");
    }
    get mapId() {
      return this.app.mapViewer.map?.data?.id ?? this.app.mapViewer.map?.id;
    }
    focusPoint(point) {
      const controls = this.app.mapViewer.controlsManager;
      if (!controls?.position?.set || !point) return false;
      controls.position.set(point.x / 32, point.y / 32, point.z / 32);
      controls.updateCamera?.();
      return true;
    }
    setPlayers(positions, names, players = []) {
      const keep = /* @__PURE__ */ new Set();
      for (const p2 of positions) {
        const id = `p${p2.player}`;
        keep.add(id);
        let marker = this.players.markers.get(id);
        if (!marker) {
          marker = new this.api.HtmlMarker(id);
          marker.anchor.set(14, 14);
          marker.element.className = "history-player";
          const head = document.createElement("img");
          head.alt = "Player skin head";
          head.draggable = false;
          const uuid = players.find((player) => player.id === p2.player)?.uuid;
          const root = this.app.mapViewer.map?.data?.mapDataRoot;
          head.src = uuid && root ? `${root}/assets/playerheads/${uuid}.png` : FALLBACK_HEAD;
          head.onerror = () => {
            head.onerror = null;
            head.src = FALLBACK_HEAD;
          };
          marker.element.append(createVitals(), head);
          marker.element.dataset.historyHead = head.src;
          marker.element.tabIndex = 0;
          this.focusTooltip(marker.element);
          this.players.add(marker);
        }
        marker.element.dataset.historyTooltip = `\u265F ${names.get(p2.player) || p2.player}
\u25F7 ${formatTimestamp(p2.time)}
\u2316 ${formatCoordinates(p2)}`;
        marker.element.dataset.player = String(p2.player);
        marker.element.dataset.time = String(p2.time);
        marker.element.setAttribute("aria-label", marker.element.dataset.historyTooltip);
        marker.element.style.borderColor = playerColor(p2.player);
        marker.position.set(p2.x / 32, p2.y / 32, p2.z / 32);
      }
      for (const [id, m2] of this.players.markers)
        if (!keep.has(id)) {
          this.players.remove(m2);
        }
    }
    setPlayerVitals(player, state = {}) {
      const element = this.players.markers.get(`p${player}`)?.element;
      renderVitals(element?.querySelector(".history-player-vitals"), state);
    }
    setPlayerHealth(player, health, maxHealth) {
      this.setPlayerVitals(player, { health, maxHealth });
    }
    clear(set) {
      for (const child of [...set.children]) {
        set.remove(child);
      }
    }
    setTrails(segments, names = /* @__PURE__ */ new Map()) {
      this.clear(this.trails);
      segments = segments.flatMap((segment) => {
        const parts = [];
        for (let offset = 0; offset < segment.length - 1; offset += 255)
          parts.push(segment.slice(offset, offset + 256));
        return parts;
      });
      for (let i2 = 0; i2 < segments.length; i2++) {
        const marker = new this.api.LineMarker(`trail${i2}`);
        marker.line.depthTest = false;
        marker.line.linewidth = 3;
        marker.line.opacity = 1;
        const segment = segments[i2];
        const first = segment?.[0];
        if (!segment || !first) continue;
        marker.line.color.setStyle(playerColor(first.player));
        marker.line.userData.historyPoints = segment;
        marker.line.userData.historyName = String(names.get(first.player) ?? first.player);
        marker.setLine(segment.flatMap((point) => [point.x / 32, point.y / 32, point.z / 32]));
        this.trails.add(marker);
      }
    }
    setEvents(events, names, _seek, registry = {}) {
      const grouped = /* @__PURE__ */ new Map();
      for (const event of events) {
        if (event.type === "CHAT") {
          grouped.set(JSON.stringify([event.point, event.type, event.payload]), [event]);
          continue;
        }
        const p2 = event.point;
        const key = `group:${p2.player}:${p2.world}:${Math.round(p2.x / 256)}:${Math.round(p2.y / 256)}:${Math.round(p2.z / 256)}`;
        const bucket = grouped.get(key) ?? [];
        bucket.push(event);
        grouped.set(key, bucket);
      }
      const keep = /* @__PURE__ */ new Set();
      for (const bucket of grouped.values()) {
        bucket.sort((a2, b2) => a2.point.time - b2.point.time);
        const e2 = bucket.at(-1);
        if (!e2) continue;
        const key = bucket.length === 1 ? JSON.stringify([e2.point, e2.type, e2.payload]) : JSON.stringify([
          "group",
          ...bucket.map((item) => [item.point.time, item.type, item.payload])
        ]);
        keep.add(key);
        let m2 = this.eventMarkers.get(key);
        if (!m2) {
          m2 = new this.api.HtmlMarker(`event${this.nextEventId++}`);
          this.eventMarkers.set(key, m2);
          m2.anchor.set(16, 16);
          m2.element.className = "history-event";
          m2.element.style.color = eventColor(e2.type);
          m2.element.style.borderColor = playerColor(e2.point.player);
          const svg = createEventIcon(e2.type);
          if (e2.type === "CHAT") {
            let payload2 = {};
            try {
              const parsed = typeof e2.payload === "string" ? JSON.parse(e2.payload) : e2.payload;
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
                payload2 = parsed;
            } catch {
            }
            m2.element.className += " history-chat-bubble";
            const player = registry.players?.find((player2) => player2.id === e2.point.player);
            const head = document.createElement("img");
            head.className = "history-chat-bubble-head";
            head.alt = "";
            const root = this.app.mapViewer.map?.data?.mapDataRoot;
            head.src = player?.uuid && root ? `${root}/assets/playerheads/${player.uuid}.png` : FALLBACK_HEAD;
            head.onerror = () => {
              head.onerror = null;
              head.src = FALLBACK_HEAD;
            };
            const copy = document.createElement("span");
            copy.className = "history-chat-bubble-copy";
            const meta = document.createElement("strong");
            meta.textContent = `${names.get(e2.point.player) || e2.point.player} \xB7 ${formatShortTimestamp(e2.point.time)}`;
            const message = document.createElement("span");
            message.textContent = String(payload2?.message || "");
            copy.append(meta, message);
            m2.element.append(head, copy);
          } else if (bucket.length > 1) {
            m2.element.classList.add("history-event-group");
            const count = document.createElement("span");
            count.className = "history-event-count";
            count.textContent = String(bucket.length);
            const list = document.createElement("div");
            list.className = "history-event-list";
            list.hidden = true;
            for (const item of bucket) {
              const detail = document.createElement("button");
              detail.type = "button";
              detail.className = "history-event-list-item";
              detail.style.color = eventColor(item.type);
              detail.style.borderLeftColor = playerColor(item.point.player);
              const details = eventDetails(item.payload, registry, item.type);
              detail.setAttribute(
                "aria-label",
                `${names.get(item.point.player) || item.point.player} \xB7 ${item.type.toLowerCase().replaceAll("_", " ")} \xB7 ${formatShortTimestamp(item.point.time)}`
              );
              const copy = document.createElement("span");
              const title = document.createElement("strong");
              title.textContent = formatShortTimestamp(item.point.time) + " \xB7 " + item.type.toLowerCase().replaceAll("_", " ");
              const description = document.createElement("small");
              description.textContent = details || `Position: ${formatCoordinates(item.point)}`;
              copy.append(title, description);
              detail.append(createEventIcon(item.type), copy);
              detail.onclick = (event) => event.stopPropagation();
              list.append(detail);
            }
            m2.element.append(svg, count, list);
          } else m2.element.append(svg);
          if (e2.type !== "CHAT" && bucket.length === 1) this.focusTooltip(m2.element);
          this.events.add(m2);
        }
        const payload = eventDetails(e2.payload, registry, e2.type);
        if (e2.type !== "CHAT" && bucket.length === 1) {
          const label = e2.type.toLowerCase().replaceAll("_", " ");
          const showPosition = [
            "BLOCK_BREAK",
            "BLOCK_PLACE",
            "CONTAINER_OPEN",
            "ITEM_PICKUP",
            "ITEM_DROP"
          ].includes(e2.type);
          m2.element.dataset.historyTooltip = `${names.get(e2.point.player) || e2.point.player} \xB7 ${label}
${formatTimestamp(e2.point.time)}${showPosition ? `
Position: ${formatCoordinates(e2.point)}` : ""}${payload ? `
${payload}` : ""}`;
          const player = registry.players?.find((player2) => player2.id === e2.point.player);
          const root = this.app.mapViewer.map?.data?.mapDataRoot;
          m2.element.dataset.historyHead = player?.uuid && root ? `${root}/assets/playerheads/${player.uuid}.png` : FALLBACK_HEAD;
        } else {
          delete m2.element.dataset.historyTooltip;
          delete m2.element.dataset.historyHead;
        }
        m2.element.onclick = (event) => {
          event?.stopPropagation?.();
          if (m2.element.querySelector?.(".history-event-list")) this.expandEventGroup(m2);
          else if (e2.type !== "CHAT") m2.element.focus?.();
        };
        if (e2.type !== "CHAT") {
          m2.element.tabIndex = 0;
          m2.element.setAttribute("role", "button");
        }
        if (bucket.length > 1) {
          m2.element.setAttribute("aria-expanded", "false");
          m2.element.setAttribute("aria-label", `${bucket.length} events; click to expand`);
        } else if (m2.element.dataset.historyTooltip)
          m2.element.setAttribute("aria-label", m2.element.dataset.historyTooltip);
        m2.element.onkeydown = (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            m2.element.click();
          }
        };
        m2.position.set(e2.point.x / 32, e2.point.y / 32, e2.point.z / 32);
      }
      for (const [key, marker] of this.eventMarkers)
        if (!keep.has(key)) {
          this.events.remove(marker);
          this.eventMarkers.delete(key);
        }
      if (this.expandedGroup && ![...this.eventMarkers.values()].includes(this.expandedGroup))
        this.collapseEventGroup();
      else if (this.expandedGroup)
        for (const marker of this.eventMarkers.values())
          marker.element.hidden = marker !== this.expandedGroup;
    }
    layoutEvents() {
      for (const marker of this.eventMarkers.values()) {
        marker.offsetX = 0;
        marker.offsetY = 0;
        marker.element.style.translate = "0 0";
        marker.element.style.setProperty?.("--connector-start", "0px");
        marker.element.style.setProperty?.("--connector-length", "0px");
      }
    }
    setHeatmap(rows, size, opacity) {
      this.clearHeatmap();
      if (!rows.length) return;
      const T2 = this.api.Three, positions = [], colors = [], max = rows.reduce((max2, r2) => Math.max(max2, r2[4]), 0);
      const height = this.app.mapViewer.controlsManager?.position?.y ?? 64;
      for (const row of rows) {
        const x2 = row[2] * size, z2 = row[3] * size, value = Math.log1p(row[4]) / Math.log1p(max), c2 = new T2.Color().setHSL((1 - value) * 0.65, 1, 0.5);
        for (const [dx, dz] of [
          [0, 0],
          [1, 1],
          [1, 0],
          [0, 0],
          [0, 1],
          [1, 1]
        ]) {
          positions.push(x2 + dx * size, height, z2 + dz * size);
          colors.push(c2.r, c2.g, c2.b);
        }
      }
      const geometry = new T2.BufferGeometry();
      geometry.setAttribute("position", new T2.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new T2.Float32BufferAttribute(colors, 3));
      const material = new T2.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        side: T2.DoubleSide
      });
      this.heat = new T2.Mesh(geometry, material);
      this.heat.renderOrder = 100;
      this.root.add(this.heat);
    }
    clearHeatmap() {
      if (this.heat) {
        this.root.remove(this.heat);
        this.heat.geometry.dispose();
        this.heat.material.dispose();
        this.heat = null;
      }
    }
    dispose() {
      this.hoverListeners.abort();
      if (this.hoverFrame !== void 0) cancelAnimationFrame(this.hoverFrame);
      this.tooltip.remove();
      this.clearHeatmap();
      this.clear(this.players);
      this.clear(this.trails);
      this.clear(this.events);
      this.app.popupMarkerSet.remove(this.root);
    }
  };

  // src/http-client.ts
  var HistoryClient = class {
    constructor(base, fetcher = (...args) => fetch(...args)) {
      this.base = base;
      this.fetcher = fetcher;
    }
    base;
    fetcher;
    async json(path, signal) {
      const response = await this.fetcher(new URL(path, this.base), {
        cache: "no-store",
        ...signal ? { signal } : {}
      });
      if (!response.ok) throw new Error(`History HTTP ${response.status}`);
      if (!response.json) throw new Error("History response is not JSON");
      return response.json();
    }
    async manifest(signal) {
      return parseManifest(await this.json("data/manifest.json", signal));
    }
    async integration(signal) {
      return parseIntegration(await this.json("integration.json", signal));
    }
    async live(signal) {
      return parseLiveSnapshot(await this.json(`data/live.json?t=${Date.now()}`, signal));
    }
    async activity(day, signal) {
      const response = await this.fetcher(new URL(`data/activity/${day}.json`, this.base), {
        cache: "no-store",
        ...signal ? { signal } : {}
      });
      if (response.status === 404) return [];
      if (!response.ok) throw new Error("Recording density unavailable");
      if (!response.json) throw new Error("Response is not JSON");
      const value = await response.json();
      if (!Array.isArray(value) || value.length > 1440) throw new Error("Invalid recording density");
      return value.flatMap(
        (row) => Array.isArray(row) && row.length === 2 && row.every(Number.isFinite) ? [[row[0], row[1]]] : []
      );
    }
    async heatmap(level, time, signal) {
      const response = await this.fetcher(new URL(`data/heatmap/${level}/${time}.json`, this.base), {
        cache: "no-store",
        ...signal ? { signal } : {}
      });
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`Heatmap HTTP ${response.status}`);
      if (!response.json) throw new Error("Response is not JSON");
      const value = await response.json();
      if (!Array.isArray(value)) throw new Error("Invalid heatmap data");
      return value.filter((row) => Array.isArray(row) && row.every(Number.isFinite));
    }
  };
  var ChatClient = class {
    constructor(token, fetcher = (...args) => fetch(...args)) {
      this.token = token;
      this.fetcher = fetcher;
    }
    token;
    fetcher;
    async request(action, body = {}) {
      const response = await this.fetcher(`/player-history-api/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token()}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8e3)
      });
      if (!response.headers?.get("content-type")?.includes("application/json")) {
        throw new Error("Web chat is unavailable. The server needs its chat API proxy configured.");
      }
      if (!response.json) throw new Error("Response is not JSON");
      const value = await response.json();
      if (!response.ok) {
        const message = typeof value === "object" && value && "error" in value ? String(value.error) : "Web chat unavailable";
        throw new Error(message);
      }
      return value;
    }
    async pair() {
      const value = await this.request("pair");
      if (!value || typeof value !== "object" || !("token" in value) || !("code" in value)) {
        throw new Error("Invalid chat pairing response");
      }
      return { token: String(value.token), code: String(value.code) };
    }
    async session() {
      return parseChatSession(await this.request("session"));
    }
    async logout() {
      await this.request("logout");
    }
    async send(message) {
      await this.request("send", { message });
    }
    async feed() {
      const response = await this.fetcher("/player-history-api/messages", {
        cache: "no-store",
        signal: AbortSignal.timeout(8e3)
      });
      if (!response.ok) throw new Error("Chat feed unavailable");
      if (!response.json) throw new Error("Chat feed returned an invalid response");
      return parseChatFeed(await response.json());
    }
  };

  // src/replay-core.ts
  var BREAK = 1;
  var OFFLINE = 2;
  var CONTEXT = 8;
  var connects = (from, to) => !(from.flags & OFFLINE) && from.world === to.world && !(to.flags & BREAK);
  var mergePoints = (chunks) => {
    const points = chunks.flatMap((chunk) => chunk.points);
    const originals = new Set(
      points.filter((point) => !(point.flags & CONTEXT)).map((point) => `${point.player}:${point.time}`)
    );
    const seen = /* @__PURE__ */ new Set();
    return points.filter((point) => {
      if (point.flags & CONTEXT && originals.has(`${point.player}:${point.time}`)) return false;
      const key = JSON.stringify(point);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((left, right) => left.time - right.time);
  };
  var pointAt = (from, to, time) => {
    const ratio = to.time === from.time ? 1 : (time - from.time) / (to.time - from.time);
    return {
      ...from,
      time,
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio,
      z: from.z + (to.z - from.z) * ratio
    };
  };
  var ReplayEngine = class {
    players = /* @__PURE__ */ new Map();
    constructor(points = []) {
      this.setPoints(points);
    }
    setPoints(points) {
      this.players.clear();
      for (const point of points) {
        const playerPoints = this.players.get(point.player) ?? [];
        playerPoints.push(point);
        this.players.set(point.player, playerPoints);
      }
    }
    position(id, time) {
      const points = this.players.get(id) ?? [];
      let low = 0;
      let high = points.length;
      while (low < high) {
        const middle = low + high >>> 1;
        const point = points[middle];
        if (point && point.time <= time) low = middle + 1;
        else high = middle;
      }
      if (!low) return null;
      const from = points[low - 1];
      const to = points[low];
      if (!from || from.flags & OFFLINE) return null;
      if (!to || !connects(from, to) || to.time === from.time) return { ...from };
      return pointAt(from, to, time);
    }
    trails(id, fromTime, toTime) {
      const points = this.players.get(id) ?? [];
      const segments = [];
      let line = [];
      for (let index = 1; index < points.length; index++) {
        const from = points[index - 1];
        const to = points[index];
        if (!from || !to) continue;
        if (to.time < fromTime || from.time > toTime || !connects(from, to)) {
          if (line.length > 1) segments.push(line);
          line = [];
          continue;
        }
        const low = Math.max(fromTime, from.time);
        const high = Math.min(toTime, to.time);
        if (high < low) continue;
        if (!line.length) line.push(pointAt(from, to, low));
        line.push(pointAt(from, to, high));
      }
      if (line.length > 1) segments.push(line);
      return segments;
    }
  };
  var ChunkCache = class {
    constructor(base, duration, fetcher = (...args) => fetch(...args), availableRanges) {
      this.base = base;
      this.duration = duration;
      this.fetcher = fetcher;
      this.availableRanges = availableRanges;
    }
    base;
    duration;
    cache = /* @__PURE__ */ new Map();
    fetcher;
    generation = 0;
    controller;
    availableRanges;
    setAvailableRanges(ranges) {
      this.availableRanges = ranges;
    }
    isPublished(start) {
      if (!this.availableRanges) return true;
      let low = 0;
      let high = this.availableRanges.length;
      while (low < high) {
        const middle = low + high >>> 1;
        const range = this.availableRanges[middle];
        if (!range || start < range[0]) high = middle;
        else if (start >= range[1]) low = middle + 1;
        else return true;
      }
      return false;
    }
    remember(start, chunk) {
      this.cache.set(start, chunk);
      while (this.cache.size > 3) {
        const oldest = this.cache.keys().next().value;
        if (oldest === void 0) break;
        this.cache.delete(oldest);
      }
      return chunk;
    }
    async read(start, signal) {
      const cached = this.cache.get(start);
      if (cached) return cached;
      if (!this.isPublished(start)) {
        const gap = parseChunk({ points: [], events: [] });
        return this.remember(start, gap);
      }
      const response = await this.fetcher(`${this.base}/chunks/${start}.json`, {
        cache: "no-store",
        ...signal ? { signal } : {}
      });
      if (!response.ok && response.status !== 404) throw new Error(`History HTTP ${response.status}`);
      const text = response.status === 404 ? '{"points":[],"events":[]}' : response.text ? await response.text() : (() => {
        throw new Error("History chunk response is not text");
      })();
      if (text.length > 64 * 1024 * 1024) throw new Error("Chunk exceeds browser size limit");
      const chunk = parseChunk(JSON.parse(text));
      if (signal?.aborted) throw new DOMException("Obsolete read", "AbortError");
      return this.remember(start, chunk);
    }
    async window(time) {
      this.controller?.abort();
      this.controller = new AbortController();
      const generation = ++this.generation;
      const start = Math.floor(time / this.duration) * this.duration;
      const chunks = await Promise.all(
        [start - this.duration, start, start + this.duration].map(
          (value) => this.read(value, this.controller?.signal)
        )
      );
      if (generation !== this.generation) throw new DOMException("Obsolete seek", "AbortError");
      const current = chunks[1];
      if (!current) throw new Error("Missing current history chunk");
      return {
        points: current.points.length ? mergePoints(chunks) : [],
        events: chunks.flatMap((chunk) => chunk.events)
      };
    }
    clear() {
      this.generation++;
      this.controller?.abort();
      this.cache.clear();
    }
  };
  var heatmapPlan = (from, to, chunk) => {
    const start = Math.floor(from / chunk) * chunk;
    const end = Math.ceil(to / chunk) * chunk;
    const plan = [];
    for (let time = start; time < end; ) {
      let span = chunk;
      let level = "chunk";
      if (time % 864e5 === 0 && end - time >= 864e5) {
        span = 864e5;
        level = "day";
      } else if (time % 36e5 === 0 && end - time >= 36e5) {
        span = 36e5;
        level = "hour";
      }
      plan.push({ time, level });
      time += span;
      if (plan.length > 2e3)
        throw new Error("Heatmap range exceeds 2000 aggregate files; narrow the range");
    }
    return plan;
  };

  // src/replay-state.ts
  var HISTORY_WINDOW = 3 * 36e5;
  var clamp = (value, from, to) => Math.max(from, Math.min(to, value));
  var addActivityBins = (bins, rows, from, to) => {
    for (const [time, count] of rows) {
      if (!Number.isFinite(time) || !Number.isFinite(count) || count <= 0) continue;
      if (from === to) {
        if (time <= from && from < time + 6e4) bins[0] = (bins[0] ?? 0) + count;
        continue;
      }
      const low = Math.max(from, time);
      const high = Math.min(to, time + 6e4);
      if (high <= low) continue;
      const width = (to - from) / bins.length;
      const first = Math.max(0, Math.floor((low - from) / width));
      const last = Math.min(bins.length - 1, Math.ceil((high - from) / width) - 1);
      for (let index = first; index <= last; index++) {
        const overlap = Math.min(high, from + (index + 1) * width) - Math.max(low, from + index * width);
        bins[index] = (bins[index] ?? 0) + count * overlap / 6e4;
      }
    }
  };
  var ReplayClock = class {
    playbackRate = 1;
    rangeDuration = HISTORY_WINDOW;
    customRange = null;
    isPlaying = false;
    from = 0;
    to = 0;
    time = Number.NaN;
    get atLatest() {
      return Number.isFinite(this.time) && this.to - this.time <= 1e3;
    }
    get rate() {
      return this.isPlaying ? this.playbackRate : 0;
    }
    refresh(earliest, latest, reset = false) {
      const follow = reset || !Number.isFinite(this.time) || this.atLatest;
      this.from = this.customRange ? this.customRange.from : Number.isFinite(this.rangeDuration) ? latest - this.rangeDuration : earliest;
      this.to = this.customRange ? this.customRange.to : latest;
      this.seek(follow ? this.to : this.time);
    }
    seek(time) {
      this.time = clamp(time, this.from, this.to);
    }
    togglePlayback() {
      if (!this.isPlaying && this.time >= this.to) this.seek(this.from);
      this.isPlaying = !this.isPlaying;
    }
    tick(delta) {
      this.seek(this.time + delta * this.rate);
      if (this.time >= this.to) this.isPlaying = false;
    }
  };
  var clusterTimelineEvents = (events, thresholdMs) => {
    const sorted = [...events].sort((left, right) => left.point.time - right.point.time);
    const clusters = [];
    for (const event of sorted) {
      const last = clusters.at(-1);
      if (last?.length) {
        const previous = last.at(-1);
        if (previous && event.point.time - previous.point.time <= thresholdMs) {
          last.push(event);
          continue;
        }
      }
      clusters.push([event]);
    }
    return clusters;
  };
  var visibleEvents = (events, options) => {
    const disabled = options.disabled ?? /* @__PURE__ */ new Set();
    const start = options.trailMode === Infinity ? options.from : Math.max(options.from, options.time - (options.trailMode || 3e4));
    return events.filter(
      (event) => !disabled.has(event.type) && event.point.time >= start && event.point.time <= options.time
    );
  };
  var productionPayload = (event) => {
    try {
      const value = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  };
  var combineProductionEvents = (events, windowMs = 6e4) => {
    const result = [];
    const sessions = /* @__PURE__ */ new Map();
    for (const event of [...events].sort((left, right) => left.point.time - right.point.time)) {
      if (event.type !== "CRAFT" && event.type !== "SMELT") {
        result.push(event);
        continue;
      }
      const payload = productionPayload(event);
      if (!payload) {
        result.push(event);
        continue;
      }
      const key = JSON.stringify([
        event.point.player,
        event.type,
        payload.item ?? payload.name ?? "unknown"
      ]);
      const session = sessions.get(key);
      const amount = typeof payload.count === "number" ? payload.count : 1;
      if (!session || event.point.time - session.lastTime > windowMs) {
        sessions.set(key, { index: result.length, lastTime: event.point.time, count: amount });
        result.push({ ...event, payload: { ...payload, count: amount } });
        continue;
      }
      session.lastTime = event.point.time;
      session.count += amount;
      const first = result[session.index];
      if (first && typeof first.payload !== "string") {
        result[session.index] = {
          ...first,
          payload: { ...first.payload, count: session.count }
        };
      }
    }
    return result;
  };

  // src/time-format.ts
  var formatDate = (time, seconds = true) => new Date(time).toLocaleString(void 0, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...seconds ? { second: "2-digit" } : {}
  });

  // node_modules/preact/dist/preact.module.js
  var n;
  var l;
  var u;
  var t;
  var i;
  var r;
  var o;
  var e;
  var f;
  var c;
  var a;
  var s;
  var h;
  var p;
  var v;
  var y;
  var d = {};
  var w = [];
  var _ = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
  var g = Array.isArray;
  function m(n2, l2) {
    for (var u3 in l2) n2[u3] = l2[u3];
    return n2;
  }
  function b(n2) {
    n2 && n2.parentNode && n2.parentNode.removeChild(n2);
  }
  function k(l2, u3, t2) {
    var i2, r2, o2, e2 = {};
    for (o2 in u3) "key" == o2 ? i2 = u3[o2] : "ref" == o2 ? r2 = u3[o2] : e2[o2] = u3[o2];
    if (arguments.length > 2 && (e2.children = arguments.length > 3 ? n.call(arguments, 2) : t2), "function" == typeof l2 && null != l2.defaultProps) for (o2 in l2.defaultProps) void 0 === e2[o2] && (e2[o2] = l2.defaultProps[o2]);
    return x(l2, e2, i2, r2, null);
  }
  function x(n2, t2, i2, r2, o2) {
    var e2 = { type: n2, props: t2, key: i2, ref: r2, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: null == o2 ? ++u : o2, __i: -1, __u: 0 };
    return null == o2 && null != l.vnode && l.vnode(e2), e2;
  }
  function S(n2) {
    return n2.children;
  }
  function C(n2, l2) {
    this.props = n2, this.context = l2;
  }
  function $(n2, l2) {
    if (null == l2) return n2.__ ? $(n2.__, n2.__i + 1) : null;
    for (var u3; l2 < n2.__k.length; l2++) if (null != (u3 = n2.__k[l2]) && null != u3.__e) return u3.__e;
    return "function" == typeof n2.type ? $(n2) : null;
  }
  function I(n2) {
    if (n2.__P && n2.__d) {
      var u3 = n2.__v, t2 = u3.__e, i2 = [], r2 = [], o2 = m({}, u3);
      o2.__v = u3.__v + 1, l.vnode && l.vnode(o2), q(n2.__P, o2, u3, n2.__n, n2.__P.namespaceURI, 32 & u3.__u ? [t2] : null, i2, null == t2 ? $(u3) : t2, !!(32 & u3.__u), r2), o2.__v = u3.__v, o2.__.__k[o2.__i] = o2, D(i2, o2, r2), u3.__e = u3.__ = null, o2.__e != t2 && P(o2);
    }
  }
  function P(n2) {
    if (null != (n2 = n2.__) && null != n2.__c) return n2.__e = n2.__c.base = null, n2.__k.some(function(l2) {
      if (null != l2 && null != l2.__e) return n2.__e = n2.__c.base = l2.__e;
    }), P(n2);
  }
  function A(n2) {
    (!n2.__d && (n2.__d = true) && i.push(n2) && !H.__r++ || r != l.debounceRendering) && ((r = l.debounceRendering) || o)(H);
  }
  function H() {
    try {
      for (var n2, l2 = 1; i.length; ) i.length > l2 && i.sort(e), n2 = i.shift(), l2 = i.length, I(n2);
    } finally {
      i.length = H.__r = 0;
    }
  }
  function L(n2, l2, u3, t2, i2, r2, o2, e2, f3, c2, a2) {
    var s2, h2, p2, v2, y2, _2, g2 = t2 && t2.__k || w, m2 = l2.length;
    for (f3 = T(u3, l2, g2, f3, m2), s2 = 0; s2 < m2; s2++) null != (p2 = u3.__k[s2]) && (h2 = -1 != p2.__i && g2[p2.__i] || d, p2.__i = s2, _2 = q(n2, p2, h2, i2, r2, o2, e2, f3, c2, a2), v2 = p2.__e, p2.ref && h2.ref != p2.ref && (h2.ref && J(h2.ref, null, p2), a2.push(p2.ref, p2.__c || v2, p2)), null == y2 && null != v2 && (y2 = v2), 4 & p2.__u ? (f3 = j(p2, f3, n2), h2.__e && (h2.__e = null)) : "function" == typeof p2.type && void 0 !== _2 ? f3 = _2 : v2 && (f3 = v2.nextSibling), p2.__u &= -7);
    return u3.__e = y2, f3;
  }
  function T(n2, l2, u3, t2, i2) {
    var r2, o2, e2, f3, c2, a2 = u3.length, s2 = a2, h2 = 0;
    for (n2.__k = new Array(i2), r2 = 0; r2 < i2; r2++) null != (o2 = l2[r2]) && "boolean" != typeof o2 && "function" != typeof o2 ? ("string" == typeof o2 || "number" == typeof o2 || "bigint" == typeof o2 || o2.constructor == String ? o2 = n2.__k[r2] = x(null, o2, null, null, null) : g(o2) ? o2 = n2.__k[r2] = x(S, { children: o2 }, null, null, null) : void 0 === o2.constructor && o2.__b > 0 ? o2 = n2.__k[r2] = x(o2.type, o2.props, o2.key, o2.ref ? o2.ref : null, o2.__v) : n2.__k[r2] = o2, f3 = r2 + h2, o2.__ = n2, o2.__b = n2.__b + 1, e2 = null, -1 != (c2 = o2.__i = O(o2, u3, f3, s2)) && (s2--, (e2 = u3[c2]) && (e2.__u |= 2)), null == e2 || null == e2.__v ? (-1 == c2 && (i2 > a2 ? h2-- : i2 < a2 && h2++), "function" != typeof o2.type && (o2.__u |= 4)) : c2 != f3 && (c2 == f3 - 1 ? h2-- : c2 == f3 + 1 ? h2++ : (c2 > f3 ? h2-- : h2++, o2.__u |= 4))) : n2.__k[r2] = null;
    if (s2) for (r2 = 0; r2 < a2; r2++) null != (e2 = u3[r2]) && 0 == (2 & e2.__u) && (e2.__e == t2 && (t2 = $(e2)), K(e2, e2));
    return t2;
  }
  function j(n2, l2, u3) {
    var t2, i2;
    if ("function" == typeof n2.type) {
      for (t2 = n2.__k, i2 = 0; t2 && i2 < t2.length; i2++) t2[i2] && (t2[i2].__ = n2, l2 = j(t2[i2], l2, u3));
      return l2;
    }
    n2.__e != l2 && (l2 && n2.type && !l2.parentNode && (l2 = $(n2)), l2 = u3.insertBefore(n2.__e, l2 || null));
    do {
      l2 = l2 && l2.nextSibling;
    } while (null != l2 && 8 == l2.nodeType);
    return l2;
  }
  function O(n2, l2, u3, t2) {
    var i2, r2, o2, e2 = n2.key, f3 = n2.type, c2 = l2[u3], a2 = null != c2 && 0 == (2 & c2.__u);
    if (null === c2 && null == e2 || a2 && e2 == c2.key && f3 == c2.type) return u3;
    if (t2 > (a2 ? 1 : 0)) {
      for (i2 = u3 - 1, r2 = u3 + 1; i2 >= 0 || r2 < l2.length; ) if (null != (c2 = l2[o2 = i2 >= 0 ? i2-- : r2++]) && 0 == (2 & c2.__u) && e2 == c2.key && f3 == c2.type) return o2;
    }
    return -1;
  }
  function z(n2, l2, u3) {
    "-" == l2[0] ? n2.setProperty(l2, null == u3 ? "" : u3) : n2[l2] = null == u3 ? "" : "number" != typeof u3 || _.test(l2) ? u3 : u3 + "px";
  }
  function N(n2, l2, u3, t2, i2) {
    var r2, o2;
    n: if ("style" == l2) if ("string" == typeof u3) n2.style.cssText = u3;
    else {
      if ("string" == typeof t2 && (n2.style.cssText = t2 = ""), t2) for (l2 in t2) u3 && l2 in u3 || z(n2.style, l2, "");
      if (u3) for (l2 in u3) t2 && u3[l2] == t2[l2] || z(n2.style, l2, u3[l2]);
    }
    else if ("o" == l2[0] && "n" == l2[1]) r2 = l2 != (l2 = l2.replace(s, "$1")), o2 = l2.toLowerCase(), l2 = o2 in n2 || "onFocusOut" == l2 || "onFocusIn" == l2 ? o2.slice(2) : l2.slice(2), n2.l || (n2.l = {}), n2.l[l2 + r2] = u3, u3 ? t2 ? u3[a] = t2[a] : (u3[a] = h, n2.addEventListener(l2, r2 ? v : p, r2)) : n2.removeEventListener(l2, r2 ? v : p, r2);
    else {
      if ("http://www.w3.org/2000/svg" == i2) l2 = l2.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
      else if ("width" != l2 && "height" != l2 && "href" != l2 && "list" != l2 && "form" != l2 && "tabIndex" != l2 && "download" != l2 && "rowSpan" != l2 && "colSpan" != l2 && "role" != l2 && "popover" != l2 && l2 in n2) try {
        n2[l2] = null == u3 ? "" : u3;
        break n;
      } catch (n3) {
      }
      "function" == typeof u3 || (null == u3 || false === u3 && "-" != l2[4] ? n2.removeAttribute(l2) : n2.setAttribute(l2, "popover" == l2 && 1 == u3 ? "" : u3));
    }
  }
  function V(n2) {
    return function(u3) {
      if (this.l) {
        var t2 = this.l[u3.type + n2];
        if (null == u3[c]) u3[c] = h++;
        else if (u3[c] < t2[a]) return;
        return t2(l.event ? l.event(u3) : u3);
      }
    };
  }
  function q(n2, u3, t2, i2, r2, o2, e2, f3, c2, a2) {
    var s2, h2, p2, v2, y2, d2, _2, k2, x2, M, I2, P2, A2, H2, T2, j2, F = u3.type;
    if (void 0 !== u3.constructor) return null;
    128 & t2.__u && (c2 = !!(32 & t2.__u), o2 = [f3 = u3.__e = t2.__e]), (s2 = l.__b) && s2(u3);
    n: if ("function" == typeof F) {
      h2 = e2.length;
      try {
        if (x2 = u3.props, M = F.prototype && F.prototype.render, I2 = (s2 = F.contextType) && i2[s2.__c], P2 = s2 ? I2 ? I2.props.value : s2.__ : i2, t2.__c ? k2 = (p2 = u3.__c = t2.__c).__ = p2.__E : (M ? u3.__c = p2 = new F(x2, P2) : (u3.__c = p2 = new C(x2, P2), p2.constructor = F, p2.render = Q), I2 && I2.sub(p2), p2.state || (p2.state = {}), p2.__n = i2, v2 = p2.__d = true, p2.__h = [], p2._sb = []), M && null == p2.__s && (p2.__s = p2.state), M && null != F.getDerivedStateFromProps && (p2.__s == p2.state && (p2.__s = m({}, p2.__s)), m(p2.__s, F.getDerivedStateFromProps(x2, p2.__s))), y2 = p2.props, d2 = p2.state, p2.__v = u3, v2) M && null == F.getDerivedStateFromProps && null != p2.componentWillMount && p2.componentWillMount(), M && null != p2.componentDidMount && p2.__h.push(p2.componentDidMount);
        else {
          if (M && null == F.getDerivedStateFromProps && x2 !== y2 && null != p2.componentWillReceiveProps && p2.componentWillReceiveProps(x2, P2), u3.__v == t2.__v || !p2.__e && null != p2.shouldComponentUpdate && false === p2.shouldComponentUpdate(x2, p2.__s, P2)) {
            u3.__v != t2.__v && (p2.props = x2, p2.state = p2.__s, p2.__d = false), u3.__e = t2.__e, u3.__k = t2.__k, u3.__k.some(function(n3) {
              n3 && (n3.__ = u3);
            }), w.push.apply(p2.__h, p2._sb), p2._sb = [], p2.__h.length && e2.push(p2), f3 = $(t2);
            break n;
          }
          null != p2.componentWillUpdate && p2.componentWillUpdate(x2, p2.__s, P2), M && null != p2.componentDidUpdate && p2.__h.push(function() {
            p2.componentDidUpdate(y2, d2, _2);
          });
        }
        if (p2.context = P2, p2.props = x2, p2.__P = n2, p2.__e = false, A2 = l.__r, H2 = 0, M) p2.state = p2.__s, p2.__d = false, A2 && A2(u3), s2 = p2.render(p2.props, p2.state, p2.context), w.push.apply(p2.__h, p2._sb), p2._sb = [];
        else do {
          p2.__d = false, A2 && A2(u3), s2 = p2.render(p2.props, p2.state, p2.context), p2.state = p2.__s;
        } while (p2.__d && ++H2 < 25);
        p2.state = p2.__s, null != p2.getChildContext && (i2 = m(m({}, i2), p2.getChildContext())), M && !v2 && null != p2.getSnapshotBeforeUpdate && (_2 = p2.getSnapshotBeforeUpdate(y2, d2)), T2 = null != s2 && s2.type === S && null == s2.key ? E(s2.props.children) : s2, f3 = L(n2, g(T2) ? T2 : [T2], u3, t2, i2, r2, o2, e2, f3, c2, a2), p2.base = u3.__e, u3.__u &= -161, p2.__h.length && e2.push(p2), k2 && (p2.__E = p2.__ = null);
      } catch (n3) {
        if (e2.length = h2, u3.__v = null, c2 || null != o2) {
          if (n3.then) {
            for (u3.__u |= c2 ? 160 : 128; f3 && 8 == f3.nodeType && f3.nextSibling; ) f3 = f3.nextSibling;
            null != o2 && (o2[o2.indexOf(f3)] = null), u3.__e = f3;
          } else if (null != o2) for (j2 = o2.length; j2--; ) b(o2[j2]);
        } else u3.__e = t2.__e;
        null == u3.__k && (u3.__k = t2.__k || []), n3.then || B(u3), l.__e(n3, u3, t2);
      }
    } else null == o2 && u3.__v == t2.__v ? (u3.__k = t2.__k, u3.__e = t2.__e) : f3 = u3.__e = G(t2.__e, u3, t2, i2, r2, o2, e2, c2, a2);
    return (s2 = l.diffed) && s2(u3), 128 & u3.__u ? void 0 : f3;
  }
  function B(n2) {
    n2 && (n2.__c && (n2.__c.__e = true), n2.__k && n2.__k.some(B));
  }
  function D(n2, u3, t2) {
    for (var i2 = 0; i2 < t2.length; i2++) J(t2[i2], t2[++i2], t2[++i2]);
    l.__c && l.__c(u3, n2), n2.some(function(u4) {
      try {
        n2 = u4.__h, u4.__h = [], n2.some(function(n3) {
          n3.call(u4);
        });
      } catch (n3) {
        l.__e(n3, u4.__v);
      }
    });
  }
  function E(n2) {
    return "object" != typeof n2 || null == n2 || n2.__b > 0 ? n2 : g(n2) ? n2.map(E) : void 0 !== n2.constructor ? null : m({}, n2);
  }
  function G(u3, t2, i2, r2, o2, e2, f3, c2, a2) {
    var s2, h2, p2, v2, y2, w2, _2, m2 = i2.props || d, k2 = t2.props, x2 = t2.type;
    if ("svg" == x2 ? o2 = "http://www.w3.org/2000/svg" : "math" == x2 ? o2 = "http://www.w3.org/1998/Math/MathML" : o2 || (o2 = "http://www.w3.org/1999/xhtml"), null != e2) {
      for (s2 = 0; s2 < e2.length; s2++) if ((y2 = e2[s2]) && "setAttribute" in y2 == !!x2 && (x2 ? y2.localName == x2 : 3 == y2.nodeType)) {
        u3 = y2, e2[s2] = null;
        break;
      }
    }
    if (null == u3) {
      if (null == x2) return document.createTextNode(k2);
      u3 = document.createElementNS(o2, x2, k2.is && k2), c2 && (l.__m && l.__m(t2, e2), c2 = false), e2 = null;
    }
    if (null == x2) m2 === k2 || c2 && u3.data == k2 || (u3.data = k2);
    else {
      if (e2 = "textarea" == x2 && null != k2.defaultValue ? null : e2 && n.call(u3.childNodes), !c2 && null != e2) for (m2 = {}, s2 = 0; s2 < u3.attributes.length; s2++) m2[(y2 = u3.attributes[s2]).name] = y2.value;
      for (s2 in m2) y2 = m2[s2], "dangerouslySetInnerHTML" == s2 ? p2 = y2 : "children" == s2 || s2 in k2 || "value" == s2 && "defaultValue" in k2 || "checked" == s2 && "defaultChecked" in k2 || N(u3, s2, null, y2, o2);
      for (s2 in k2) y2 = k2[s2], "children" == s2 ? v2 = y2 : "dangerouslySetInnerHTML" == s2 ? h2 = y2 : "value" == s2 ? w2 = y2 : "checked" == s2 ? _2 = y2 : c2 && "function" != typeof y2 || m2[s2] === y2 || N(u3, s2, y2, m2[s2], o2);
      if (h2) c2 || p2 && (h2.__html == p2.__html || h2.__html == u3.innerHTML) || (u3.innerHTML = h2.__html), t2.__k = [];
      else if (p2 && (u3.innerHTML = ""), L("template" == t2.type ? u3.content : u3, g(v2) ? v2 : [v2], t2, i2, r2, "foreignObject" == x2 ? "http://www.w3.org/1999/xhtml" : o2, e2, f3, e2 ? e2[0] : i2.__k && $(i2, 0), c2, a2), null != e2) for (s2 = e2.length; s2--; ) b(e2[s2]);
      c2 && "textarea" != x2 || (s2 = "value", "progress" == x2 && null == w2 ? u3.removeAttribute("value") : null != w2 && (w2 !== u3[s2] || "progress" == x2 && !w2 || "option" == x2 && w2 != m2[s2]) && N(u3, s2, w2, m2[s2], o2), s2 = "checked", null != _2 && _2 != u3[s2] && N(u3, s2, _2, m2[s2], o2));
    }
    return u3;
  }
  function J(n2, u3, t2) {
    try {
      if ("function" == typeof n2) {
        var i2 = "function" == typeof n2.__u;
        i2 && n2.__u(), i2 && null == u3 || (n2.__u = n2(u3));
      } else n2.current = u3;
    } catch (n3) {
      l.__e(n3, t2);
    }
  }
  function K(n2, u3, t2) {
    var i2, r2;
    if (l.unmount && l.unmount(n2), (i2 = n2.ref) && (i2.current && i2.current != n2.__e || J(i2, null, u3)), null != (i2 = n2.__c)) {
      if (i2.componentWillUnmount) try {
        i2.componentWillUnmount();
      } catch (n3) {
        l.__e(n3, u3);
      }
      i2.base = i2.__P = i2.__n = null;
    }
    if (i2 = n2.__k) for (r2 = 0; r2 < i2.length; r2++) i2[r2] && K(i2[r2], u3, t2 || "function" != typeof n2.type);
    t2 || b(n2.__e), n2.__c = n2.__ = n2.__e = void 0;
  }
  function Q(n2, l2, u3) {
    return this.constructor(n2, u3);
  }
  function R(u3, t2, i2) {
    var r2, o2, e2, f3;
    t2 == document && (t2 = document.documentElement), l.__ && l.__(u3, t2), o2 = (r2 = "function" == typeof i2) ? null : i2 && i2.__k || t2.__k, e2 = [], f3 = [], q(t2, u3 = (!r2 && i2 || t2).__k = k(S, null, [u3]), o2 || d, d, t2.namespaceURI, !r2 && i2 ? [i2] : o2 ? null : t2.firstChild ? n.call(t2.childNodes) : null, e2, !r2 && i2 ? i2 : o2 ? o2.__e : t2.firstChild, r2, f3), D(e2, u3, f3), u3.props.children = null;
  }
  n = w.slice, l = { __e: function(n2, l2, u3, t2) {
    for (var i2, r2, o2; l2 = l2.__; ) if ((i2 = l2.__c) && !i2.__) try {
      if ((r2 = i2.constructor) && null != r2.getDerivedStateFromError && (i2.setState(r2.getDerivedStateFromError(n2)), o2 = i2.__d), null != i2.componentDidCatch && (i2.componentDidCatch(n2, t2 || {}), o2 = i2.__d), o2) return i2.__E = i2;
    } catch (l3) {
      n2 = l3;
    }
    throw n2;
  } }, u = 0, t = function(n2) {
    return null != n2 && void 0 === n2.constructor;
  }, C.prototype.setState = function(n2, l2) {
    var u3;
    u3 = null != this.__s && this.__s != this.state ? this.__s : this.__s = m({}, this.state), "function" == typeof n2 && (n2 = n2(m({}, u3), this.props)), n2 && m(u3, n2), null != n2 && this.__v && (l2 && this._sb.push(l2), A(this));
  }, C.prototype.forceUpdate = function(n2) {
    this.__v && (this.__e = true, n2 && this.__h.push(n2), A(this));
  }, C.prototype.render = S, i = [], o = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e = function(n2, l2) {
    return n2.__v.__b - l2.__v.__b;
  }, H.__r = 0, f = Math.random().toString(8), c = "__d" + f, a = "__a" + f, s = /(PointerCapture)$|Capture$/i, h = 0, p = V(false), v = V(true), y = 0;

  // node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js
  var f2 = 0;
  function u2(e2, t2, n2, o2, i2, u3) {
    t2 || (t2 = {});
    var a2, c2, p2 = t2;
    if ("ref" in p2) for (c2 in p2 = {}, t2) "ref" == c2 ? a2 = t2[c2] : p2[c2] = t2[c2];
    var l2 = { type: e2, props: p2, key: n2, ref: a2, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: --f2, __i: -1, __u: 0, __source: i2, __self: u3 };
    if ("function" == typeof e2 && (a2 = e2.defaultProps)) for (c2 in a2) void 0 === p2[c2] && (p2[c2] = a2[c2]);
    return l.vnode && l.vnode(l2), l2;
  }

  // src/ui/history-icon.tsx
  var ICON_PATHS = {
    events: "M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42m0-12.72-1.42 1.42M7.06 16.94l-1.42 1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    heat: "M4 4h5v5H4zM10 4h5v5h-5zM16 4h4v5h-4zM4 10h5v5H4zM10 10h5v5h-5zM16 10h4v5h-4zM4 16h5v4H4zM10 16h5v4h-5zM16 16h4v4h-4z",
    players: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    speed: "M3 18a10 10 0 1 1 18 0M12 14l5-6M5 18h14",
    time: "M12 8v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9",
    trails: "M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M19 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4M7 17c4 0 3-10 8-10h2",
    webchat: "M21 11a8 8 0 0 1-8 8H7l-5 3V11a9 9 0 0 1 19 0Z"
  };
  var HistoryIcon = ({ name }) => /* @__PURE__ */ u2("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", children: /* @__PURE__ */ u2("path", { d: ICON_PATHS[name] }) });
  var TimelineEventIcon = ({ type }) => /* @__PURE__ */ u2("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ u2(
    "path",
    {
      d: type === "chat" ? "M2 2h12v9H7l-4 3v-3H2z" : "M3 7a5 5 0 0 1 10 0v4h-2v2H9v-2H7v2H5v-2H3zM5 7h2v2H5zm4 0h2v2H9z"
    }
  ) });

  // src/ui/history-events-view.tsx
  var parsePayload2 = (event) => {
    try {
      const value = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return null;
    }
  };
  var ChatHistory = ({
    events,
    names,
    players,
    mapRoot,
    formatTime,
    onSelect
  }) => {
    const uuids = new Map(players.map((player) => [player.id, player.uuid]));
    const rows = events.flatMap((event) => {
      const payload = parsePayload2(event);
      if (!payload) return [];
      return [{ event, payload }];
    });
    if (rows.length === 0) {
      return /* @__PURE__ */ u2("div", { class: "history-chat-empty", children: "No chat or player status messages in this range" });
    }
    return /* @__PURE__ */ u2(S, { children: rows.map(({ event, payload }) => {
      const name = names.get(event.point.player) ?? "Player";
      const uuid = uuids.get(event.point.player);
      const head = uuid && mapRoot ? `${mapRoot}/assets/playerheads/${uuid}.png` : void 0;
      const classes = event.type === "CHAT" ? "history-chat-row" : `history-chat-row history-chat-system history-chat-${event.type.toLowerCase()}`;
      return /* @__PURE__ */ u2(
        "button",
        {
          type: "button",
          class: classes,
          title: "Show this message on the map",
          onClick: () => onSelect(event),
          children: [
            /* @__PURE__ */ u2("span", { class: "history-chat-time", children: formatTime(event.point.time) }),
            head ? /* @__PURE__ */ u2(
              "img",
              {
                class: "history-chat-head",
                src: head,
                alt: "",
                onError: (error) => {
                  error.currentTarget.hidden = true;
                }
              }
            ) : /* @__PURE__ */ u2("span", {}),
            /* @__PURE__ */ u2("span", { children: chatMessage(event.type, name, payload) })
          ]
        },
        `${event.point.player}:${event.point.time}:${event.type}`
      );
    }) });
  };
  var TimelineEvents = ({
    events,
    from,
    to,
    timelineWidth,
    names,
    formatTime,
    onSelect
  }) => {
    const indicatorEvents = events.filter((event) => ["CHAT", "DEATH"].includes(event.type));
    const threshold = (to - from) * 18 / Math.max(1, timelineWidth || 600);
    return /* @__PURE__ */ u2(S, { children: clusterTimelineEvents(indicatorEvents, threshold).map((cluster) => {
      const hasChat = cluster.some((event) => event.type === "CHAT");
      const hasDeath = cluster.some((event) => event.type === "DEATH");
      const kind = hasChat && hasDeath ? "chat and death" : hasDeath ? "death" : "chat";
      const middle = cluster.reduce((sum, event) => sum + event.point.time, 0) / cluster.length;
      let current = 0;
      return /* @__PURE__ */ u2(
        "button",
        {
          type: "button",
          class: `history-timeline-event ${hasChat && hasDeath ? "history-mixed-tick" : hasDeath ? "history-death-tick" : "history-chat-tick"}`,
          style: {
            left: `${(middle - from) / Math.max(1, to - from) * 100}%`,
            color: hasChat && hasDeath ? "#eee" : eventColor(hasDeath ? "DEATH" : "CHAT")
          },
          "aria-label": `${cluster.length} ${kind} event${cluster.length === 1 ? "" : "s"}; click repeatedly to cycle`,
          onClick: (click) => {
            const event = cluster[current++ % cluster.length];
            if (!event) return;
            onSelect(event);
            click.currentTarget.title = `${formatTime(event.point.time)} \xB7 ${event.type.toLowerCase()} \xB7 ${names.get(event.point.player) ?? "Player"}`;
          },
          children: [
            hasChat ? /* @__PURE__ */ u2(TimelineEventIcon, { type: "chat" }) : null,
            hasDeath ? /* @__PURE__ */ u2(TimelineEventIcon, { type: "death" }) : null,
            cluster.length > 1 ? /* @__PURE__ */ u2("b", { children: cluster.length }) : null
          ]
        },
        `${cluster[0]?.point.time}:${cluster.length}:${kind}`
      );
    }) });
  };
  var renderHistoryEvents = (chatRoot, timelineRoot, props) => {
    R(/* @__PURE__ */ u2(ChatHistory, { ...props }), chatRoot);
    R(/* @__PURE__ */ u2(TimelineEvents, { ...props }), timelineRoot);
  };

  // src/overlay-coordinator.ts
  var updateReplayOverlays = (input) => {
    const { adapter, cache, manifest } = input;
    if (!adapter || !cache || !manifest || !Number.isFinite(input.clock.time)) return input.keys;
    const { from, to, time } = input.clock;
    const full = input.trailMode === Infinity;
    const start = full ? from : Math.max(from, time - input.trailMode);
    const dataKey = [
      String(input.trailMode),
      input.isLive ? Math.floor(from / cache.duration) : from,
      input.isLive ? Math.floor(to / cache.duration) : to,
      full ? "full" : Math.floor(time / cache.duration)
    ].join(":");
    if (input.trailDataKey !== dataKey && !input.trailPending) input.requestTrail(dataKey);
    const historyEngine = input.trailDataKey === dataKey ? input.fullTrails : null;
    const engine = input.isLive ? new ReplayEngine(
      mergePoints([
        {
          points: [...historyEngine?.players.values() || []].flatMap((points) => [...points]),
          events: []
        },
        { points: [...input.livePoints], events: [] }
      ])
    ) : historyEngine;
    const trailKey = [
      dataKey,
      start,
      full ? to : time,
      input.selectionRevision,
      input.world,
      !!engine,
      input.registryRevision
    ].join(":");
    if (trailKey !== input.keys.trail) {
      input.keys.trail = trailKey;
      adapter.setTrails(
        input.trailMode && engine ? [...input.selection].flatMap((id) => engine.trails(id, start, full ? to : time)).filter((line) => line[0]?.world === input.world) : [],
        new Map(input.names)
      );
    }
    const combined = new Map(
      [...input.rangeEvents, ...input.events, ...input.isLive ? input.liveEvents : []].map(
        (event) => [JSON.stringify([event.point, event.type, event.payload]), event]
      )
    );
    const selectedTimelineEvents = [...combined.values()].sort((a2, b2) => a2.point.time - b2.point.time).filter(
      (event) => input.selection.has(event.point.player) && event.point.time >= from && event.point.time <= to
    );
    const timelineEvents = combineProductionEvents(selectedTimelineEvents).filter(
      (event) => !input.disabledEvents.has(event.type)
    );
    const events = visibleEvents(timelineEvents, {
      from,
      time,
      trailMode: input.trailMode,
      disabled: new Set(input.disabledEvents)
    }).slice(-500);
    const eventKey = [
      input.eventRevision,
      input.filterRevision,
      input.selectionRevision,
      input.world,
      from,
      to,
      input.registryRevision
    ].join(":");
    if (input.keys.event !== eventKey) {
      input.keys.event = eventKey;
      adapter.setEvents(
        events.filter((event) => event.point.world === input.world),
        new Map(input.names),
        input.onSeek,
        manifest.registry
      );
    }
    const chatEvents = selectedTimelineEvents.filter((event) => ["CHAT", "JOIN", "QUIT", "DEATH"].includes(event.type)).slice(-1e3);
    const timelineKey = `${input.eventRevision}:${input.registryRevision}:${from}:${to}`;
    if (input.keys.timeline !== timelineKey) {
      input.keys.timeline = timelineKey;
      renderHistoryEvents(input.chatRoot, input.timelineRoot, {
        events: chatEvents,
        from,
        to,
        timelineWidth: input.timelineWidth,
        names: input.names,
        players: manifest.registry.players,
        ...input.mapRoot ? { mapRoot: input.mapRoot } : {},
        formatTime: formatDate,
        onSelect: input.onSelectEvent
      });
      if (input.chatPinned)
        input.schedule(() => {
          input.chatRoot.scrollTop = input.chatRoot.scrollHeight;
        });
    }
    const heatKey = [input.heatVersion, input.selectionRevision, input.world, input.heatEnabled].join(
      ":"
    );
    if (input.keys.heat !== heatKey) {
      input.keys.heat = heatKey;
      if (input.heatEnabled && input.heatRows) {
        const cells = /* @__PURE__ */ new Map();
        for (const row of input.heatRows) {
          if (!input.selection.has(row[0]) || row[1] !== input.world) continue;
          const key = `${row[2]},${row[3]}`;
          const old = cells.get(key);
          if (old) old[4] += row[4];
          else cells.set(key, [...row]);
        }
        adapter.setHeatmap([...cells.values()], manifest.cellSize, 0.55);
      } else adapter.clearHeatmap();
    }
    return input.keys;
  };

  // src/panel-controls.ts
  var PanelControls = class {
    constructor(root) {
      this.root = root;
    }
    root;
    get(name) {
      const element = this.root.querySelector(`[name="${name}"], [data-control="${name}"]`);
      if (!element) throw new Error(`Missing replay panel control: ${name}`);
      return element;
    }
  };

  // src/panel-lifecycle.ts
  var PanelLifecycle = class {
    abortController = new AbortController();
    intervals = /* @__PURE__ */ new Set();
    timeouts = /* @__PURE__ */ new Set();
    frames = /* @__PURE__ */ new Set();
    get signal() {
      return this.abortController.signal;
    }
    interval(callback, delay) {
      const timer = setInterval(callback, delay);
      this.intervals.add(timer);
      return timer;
    }
    clearInterval(timer) {
      if (timer === void 0) return;
      clearInterval(timer);
      this.intervals.delete(timer);
    }
    timeout(callback, delay) {
      const timer = setTimeout(() => {
        this.timeouts.delete(timer);
        callback();
      }, delay);
      this.timeouts.add(timer);
      return timer;
    }
    clearTimeout(timer) {
      if (timer === void 0) return;
      clearTimeout(timer);
      this.timeouts.delete(timer);
    }
    frame(callback) {
      const frame = requestAnimationFrame((time) => {
        this.frames.delete(frame);
        callback(time);
      });
      this.frames.add(frame);
      return frame;
    }
    cancelFrame(frame) {
      if (frame === void 0) return;
      cancelAnimationFrame(frame);
      this.frames.delete(frame);
    }
    dispose() {
      this.abortController.abort();
      for (const timer of this.intervals) clearInterval(timer);
      for (const timer of this.timeouts) clearTimeout(timer);
      for (const frame of this.frames) cancelAnimationFrame(frame);
      this.intervals.clear();
      this.timeouts.clear();
      this.frames.clear();
    }
  };

  // src/panel-options.ts
  var RANGE_OPTIONS = [
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
    ["custom", "Last N days\u2026"],
    ["dates", "Custom dates\u2026"]
  ];
  var rangeOptionLabel = (value) => RANGE_OPTIONS.find(([option]) => option === value)?.[1] ?? "Selected range";
  var calendarRange = (value, now) => {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    if (value === "today") return { from: today.getTime(), to: now, followsLive: true };
    if (value !== "yesterday") return null;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { from: yesterday.getTime(), to: today.getTime(), followsLive: false };
  };
  var SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];
  var TRAIL_OPTIONS = [
    [0, "Off"],
    [3e4, "30 seconds"],
    [6e4, "1 minute"],
    [3e5, "5 minutes"],
    [9e5, "15 minutes"],
    [36e5, "1 hour"],
    [216e5, "6 hours"],
    [Infinity, "Full range"]
  ];
  var trailDurationLabel = (value) => {
    if (value === Infinity) return "Full";
    if (value === 0) return "Off";
    if (value < 6e4) return `${value / 1e3}s`;
    if (value < 36e5) return `${value / 6e4}m`;
    return `${value / 36e5}h`;
  };
  var DEFAULT_DISABLED_EVENTS = [
    "ITEM_PICKUP",
    "ITEM_DROP",
    "BLOCK_PLACE",
    "BLOCK_BREAK",
    "CONTAINER_OPEN",
    "TELEPORT"
  ];
  var KNOWN_EVENT_TYPES = [
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
    "ITEM_DROP"
  ];

  // src/preferences.ts
  var KEYS = {
    range: "player-history-range",
    days: "player-history-custom-days",
    speed: "player-history-speed",
    players: "player-history-players",
    hiddenEvents: "player-history-hidden-events",
    trails: "player-history-trails",
    heatmap: "player-history-heatmap",
    chatToken: "player-history-chat-token"
  };
  var readArray = (key) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
  var preferences = {
    range: () => localStorage.getItem(KEYS.range),
    saveRange: (value) => localStorage.setItem(KEYS.range, value),
    days: () => {
      const value = Number(localStorage.getItem(KEYS.days));
      return Number.isInteger(value) && value > 0 && value <= 36500 ? value : null;
    },
    saveDays: (value) => localStorage.setItem(KEYS.days, String(value)),
    speed: () => {
      const value = Number(localStorage.getItem(KEYS.speed));
      return [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64].includes(value) ? value : null;
    },
    saveSpeed: (value) => localStorage.setItem(KEYS.speed, String(value)),
    players: () => {
      if (localStorage.getItem(KEYS.players) === null) return null;
      return readArray(KEYS.players).filter((value) => Number.isFinite(value));
    },
    savePlayers: (value) => localStorage.setItem(KEYS.players, JSON.stringify([...value])),
    hiddenEvents: () => readArray(KEYS.hiddenEvents).filter((value) => typeof value === "string"),
    saveHiddenEvents: (value) => localStorage.setItem(KEYS.hiddenEvents, JSON.stringify([...value])),
    trails: () => {
      const stored = localStorage.getItem(KEYS.trails);
      if (stored === "Infinity") return Infinity;
      const value = Number(stored);
      return Number.isFinite(value) ? value : null;
    },
    saveTrails: (value) => localStorage.setItem(KEYS.trails, String(value)),
    heatmap: () => localStorage.getItem(KEYS.heatmap) === "true",
    saveHeatmap: (value) => localStorage.setItem(KEYS.heatmap, String(value)),
    chatToken: () => localStorage.getItem(KEYS.chatToken) ?? "",
    saveChatToken: (value) => {
      if (value) localStorage.setItem(KEYS.chatToken, value);
      else localStorage.removeItem(KEYS.chatToken);
    }
  };

  // src/replay-panel-state.ts
  var createReplayPanelState = () => ({
    panel: "closed",
    mode: "live",
    scrubbing: false,
    heatmap: false,
    chatPinned: true,
    chatLoading: false,
    liveLoading: false,
    refreshing: false,
    hasSavedSelection: false
  });

  // src/request-coordinator.ts
  var RequestCoordinator = class {
    active = /* @__PURE__ */ new Map();
    start(request) {
      this.abort(request);
      const controller = new AbortController();
      this.active.set(request, controller);
      return controller;
    }
    pending(request) {
      return this.active.has(request);
    }
    current(request, controller) {
      return this.active.get(request) === controller && !controller.signal.aborted;
    }
    finish(request, controller) {
      if (this.active.get(request) === controller) this.active.delete(request);
    }
    abort(request) {
      this.active.get(request)?.abort();
      this.active.delete(request);
    }
    abortAll() {
      for (const controller of this.active.values()) controller.abort();
      this.active.clear();
    }
  };

  // src/status-coordinator.ts
  var PRIORITY = {
    error: 4,
    range: 3,
    loading: 2,
    context: 1
  };
  var StatusCoordinator = class {
    constructor(element) {
      this.element = element;
    }
    element;
    messages = /* @__PURE__ */ new Map();
    show(channel, message) {
      if (channel !== "error") this.messages.delete("error");
      this.messages.set(channel, message);
      this.render();
    }
    clear(channel) {
      this.messages.delete(channel);
      this.render();
    }
    render() {
      let selected;
      for (const channel of this.messages.keys()) {
        if (!selected || PRIORITY[channel] > PRIORITY[selected]) selected = channel;
      }
      this.element.textContent = selected ? this.messages.get(selected) ?? "" : "";
    }
  };

  // src/ui/activity-histogram-view.tsx
  var ActivityHistogram = ({ bins, from, to, formatTime }) => {
    const max = Math.max(0, ...bins);
    return /* @__PURE__ */ u2(S, { children: bins.map((count, index) => /* @__PURE__ */ u2(
      "span",
      {
        style: { height: count > 0 ? `max(2px, ${count / max * 100}%)` : "0" },
        title: `${formatTime(from + (to - from) * index / bins.length)} \xB7 ${Math.round(count).toLocaleString()} recorded samples (approx.)`
      },
      index
    )) });
  };
  var renderActivityHistogram = (root, props) => {
    R(/* @__PURE__ */ u2(ActivityHistogram, { ...props }), root);
  };

  // src/ui/event-filter-view.tsx
  var eventLabel = (type) => type.toLowerCase().replaceAll("_", " ");
  var EventFilter = ({ types, disabled, onChange }) => /* @__PURE__ */ u2(S, { children: [...types].map((type) => /* @__PURE__ */ u2("label", { children: [
    /* @__PURE__ */ u2(
      "input",
      {
        type: "checkbox",
        "aria-label": eventLabel(type),
        checked: !disabled.has(type),
        onChange: (event) => onChange(type, event.currentTarget.checked)
      }
    ),
    eventLabel(type)
  ] }, type)) });
  var renderEventFilter = (root, props) => {
    R(/* @__PURE__ */ u2(EventFilter, { ...props }), root);
  };

  // src/ui/player-filter-view.tsx
  var PlayerFilter = ({ names, selected, onChange }) => /* @__PURE__ */ u2(S, { children: [...names].map(([id, name]) => /* @__PURE__ */ u2("label", { children: [
    /* @__PURE__ */ u2(
      "input",
      {
        type: "checkbox",
        checked: selected.has(id),
        onChange: (event) => onChange(id, event.currentTarget.checked)
      }
    ),
    /* @__PURE__ */ u2("i", { class: "history-player-color", style: { background: playerColor(id) } }),
    name
  ] }, id)) });
  var renderPlayerFilter = (root, props) => {
    R(/* @__PURE__ */ u2(PlayerFilter, { ...props }), root);
  };

  // src/ui/history-chat.tsx
  var HistoryChat = () => /* @__PURE__ */ u2(S, { children: [
    /* @__PURE__ */ u2(
      "button",
      {
        type: "button",
        name: "webchat",
        class: "history-chat-launcher",
        "aria-label": "Web chat",
        title: "Web chat",
        "aria-controls": "history-chat-panel",
        "aria-expanded": "false",
        children: /* @__PURE__ */ u2(HistoryIcon, { name: "webchat" })
      }
    ),
    /* @__PURE__ */ u2("aside", { id: "history-chat-panel", class: "history-chat-panel", hidden: true, "aria-label": "Web chat", children: [
      /* @__PURE__ */ u2("div", { class: "history-chat-heading", children: [
        /* @__PURE__ */ u2("strong", { children: "Chat" }),
        /* @__PURE__ */ u2("button", { type: "button", name: "chat-close", "aria-label": "Close chat", children: "\xD7" })
      ] }),
      /* @__PURE__ */ u2("div", { class: "history-chat-content", children: [
        /* @__PURE__ */ u2(
          "div",
          {
            class: "history-chat",
            role: "log",
            "aria-live": "polite",
            "aria-label": "Chat history for selected range"
          }
        ),
        /* @__PURE__ */ u2("div", { class: "history-webchat", children: [
          /* @__PURE__ */ u2("div", { class: "history-webchat-feed", "aria-live": "polite" }),
          /* @__PURE__ */ u2("button", { type: "button", name: "chat-connect", children: "Connect Minecraft account" }),
          /* @__PURE__ */ u2("button", { type: "button", name: "chat-logout", hidden: true, children: "Log out" }),
          /* @__PURE__ */ u2("output", { name: "chat-status" }),
          /* @__PURE__ */ u2("form", { class: "history-chat-form", hidden: true, children: [
            /* @__PURE__ */ u2(
              "input",
              {
                name: "chat-message",
                "aria-label": "Chat message",
                maxLength: 256,
                placeholder: "Message the server\u2026",
                required: true
              }
            ),
            /* @__PURE__ */ u2("button", { type: "submit", children: "Send" })
          ] })
        ] })
      ] })
    ] })
  ] });

  // src/ui/history-header.tsx
  var TrailControl = () => /* @__PURE__ */ u2("div", { class: "history-trails", children: [
    /* @__PURE__ */ u2(
      "button",
      {
        type: "button",
        name: "trails-button",
        "aria-label": "Trail duration",
        title: "Trails",
        "aria-expanded": "false",
        children: [
          /* @__PURE__ */ u2(HistoryIcon, { name: "trails" }),
          /* @__PURE__ */ u2("span", { class: "history-tool-value", "data-control": "trail-label", children: "1m" })
        ]
      }
    ),
    /* @__PURE__ */ u2("div", { class: "history-trails-popover history-popover history-choices", hidden: true, children: [
      TRAIL_OPTIONS.map(([value, label]) => /* @__PURE__ */ u2("button", { type: "button", "data-trail": value, "aria-pressed": value === 6e4, children: label })),
      /* @__PURE__ */ u2("input", { name: "trails", type: "hidden", value: "60000" })
    ] })
  ] });
  var HeaderTools = () => /* @__PURE__ */ u2("div", { class: "history-header-tools", children: [
    /* @__PURE__ */ u2(TrailControl, {}),
    /* @__PURE__ */ u2("div", { class: "history-player-control", children: [
      /* @__PURE__ */ u2(
        "button",
        {
          type: "button",
          name: "players",
          "aria-expanded": "false",
          "aria-controls": "history-players",
          "aria-label": "Filter players",
          title: "Players",
          children: [
            /* @__PURE__ */ u2(HistoryIcon, { name: "players" }),
            /* @__PURE__ */ u2("span", { class: "history-tool-value", "data-control": "player-count", children: "0" })
          ]
        }
      ),
      /* @__PURE__ */ u2("div", { id: "history-players", class: "history-popover", hidden: true, children: [
        /* @__PURE__ */ u2("div", { class: "history-popover-heading", children: [
          "Players",
          /* @__PURE__ */ u2("button", { type: "button", name: "all", children: "Select all" })
        ] }),
        /* @__PURE__ */ u2("div", { class: "history-player-list" })
      ] })
    ] }),
    /* @__PURE__ */ u2(
      "button",
      {
        type: "button",
        name: "heat",
        "aria-pressed": "false",
        title: "Time spent in the replay range; completed recording chunks",
        "aria-label": "Heatmap",
        children: /* @__PURE__ */ u2(HistoryIcon, { name: "heat" })
      }
    ),
    /* @__PURE__ */ u2("details", { class: "history-event-control", children: [
      /* @__PURE__ */ u2("summary", { "aria-label": "Event filters", title: "Event filters", children: /* @__PURE__ */ u2(HistoryIcon, { name: "events" }) }),
      /* @__PURE__ */ u2("div", { class: "history-event-options history-popover", children: [
        /* @__PURE__ */ u2("div", { class: "history-event-filter-list" }),
        /* @__PURE__ */ u2("small", { children: "Unchecked types are hidden from this viewer." })
      ] })
    ] })
  ] });
  var RangeControl = () => /* @__PURE__ */ u2("div", { class: "history-range", children: [
    /* @__PURE__ */ u2(
      "button",
      {
        type: "button",
        name: "range-button",
        "aria-label": "Choose history range",
        "aria-expanded": "false",
        children: [
          /* @__PURE__ */ u2(HistoryIcon, { name: "time" }),
          /* @__PURE__ */ u2("span", { "data-control": "range-label", children: "Last 3 hours" }),
          /* @__PURE__ */ u2("span", { "aria-hidden": "true", children: "\u2304" })
        ]
      }
    ),
    /* @__PURE__ */ u2("input", { name: "range", type: "hidden", value: "0.125" }),
    /* @__PURE__ */ u2("div", { class: "history-range-popover history-popover", hidden: true, children: [
      /* @__PURE__ */ u2("div", { class: "history-absolute-range", children: [
        /* @__PURE__ */ u2("strong", { children: "Absolute time range" }),
        /* @__PURE__ */ u2("form", { class: "history-custom-dates", children: [
          /* @__PURE__ */ u2("label", { children: [
            "From ",
            /* @__PURE__ */ u2("input", { name: "date-from", type: "datetime-local", step: "1", required: true })
          ] }),
          /* @__PURE__ */ u2("label", { children: [
            "To ",
            /* @__PURE__ */ u2("input", { name: "date-to", type: "datetime-local", step: "1", required: true })
          ] }),
          /* @__PURE__ */ u2("button", { type: "submit", children: "Apply time range" })
        ] }),
        /* @__PURE__ */ u2("form", { class: "history-custom-days", children: [
          /* @__PURE__ */ u2("label", { children: [
            "Last",
            /* @__PURE__ */ u2(
              "input",
              {
                name: "days",
                "aria-label": "Number of days",
                type: "number",
                min: "1",
                max: "36500",
                step: "1",
                value: "14",
                required: true
              }
            ),
            "days"
          ] }),
          /* @__PURE__ */ u2("button", { type: "submit", children: "Apply" })
        ] })
      ] }),
      /* @__PURE__ */ u2("div", { class: "history-quick-ranges", children: [
        /* @__PURE__ */ u2("strong", { children: "Quick ranges" }),
        /* @__PURE__ */ u2("div", { class: "history-range-options", children: RANGE_OPTIONS.filter(([value]) => value !== "custom" && value !== "dates").map(
          ([value, label]) => /* @__PURE__ */ u2("button", { type: "button", "data-range": value, "aria-pressed": value === "0.125", children: label })
        ) })
      ] })
    ] })
  ] });
  var HistoryHeader = () => /* @__PURE__ */ u2(S, { children: /* @__PURE__ */ u2("div", { class: "history-heading", children: [
    /* @__PURE__ */ u2("span", { children: "\u25F7 History" }),
    /* @__PURE__ */ u2(RangeControl, {}),
    /* @__PURE__ */ u2("output", { name: "current", children: "\u2014" }),
    /* @__PURE__ */ u2(HeaderTools, {}),
    /* @__PURE__ */ u2("button", { type: "button", name: "close", "aria-label": "Close history", children: "\xD7" })
  ] }) });

  // src/ui/history-transport.tsx
  var SpeedControl = () => /* @__PURE__ */ u2("div", { class: "history-speed", children: [
    /* @__PURE__ */ u2(
      "button",
      {
        name: "speed-button",
        type: "button",
        "aria-label": "Playback speed",
        title: "Playback speed",
        "aria-expanded": "false",
        children: /* @__PURE__ */ u2(HistoryIcon, { name: "speed" })
      }
    ),
    /* @__PURE__ */ u2("div", { class: "history-speed-popover history-popover history-choices", hidden: true, children: [
      SPEED_OPTIONS.map((rate) => /* @__PURE__ */ u2("button", { type: "button", "data-speed": rate, "aria-pressed": rate === 1, children: [
        rate,
        "\xD7"
      ] })),
      /* @__PURE__ */ u2("input", { name: "speed", type: "hidden", value: "1" })
    ] })
  ] });
  var HistoryTransport = () => /* @__PURE__ */ u2(S, { children: [
    /* @__PURE__ */ u2("div", { class: "history-dates", children: [
      /* @__PURE__ */ u2("span", { "data-control": "start", children: "\u2014" }),
      /* @__PURE__ */ u2("span", { "data-control": "end", children: "\u2014" })
    ] }),
    /* @__PURE__ */ u2("div", { class: "history-timeline", children: [
      /* @__PURE__ */ u2(
        "div",
        {
          class: "history-histogram",
          role: "img",
          "aria-label": "Recording density across the selected range"
        }
      ),
      /* @__PURE__ */ u2(
        "input",
        {
          name: "timeline",
          type: "range",
          min: "0",
          max: "1",
          step: "1",
          value: "1",
          "aria-label": "Replay timeline"
        }
      ),
      /* @__PURE__ */ u2("output", { class: "history-tooltip", hidden: true }),
      /* @__PURE__ */ u2("div", { class: "history-events" })
    ] }),
    /* @__PURE__ */ u2("div", { class: "history-density-status", hidden: true, role: "status", children: "Recording density \xB7 all players \xB7 1-minute resolution" }),
    /* @__PURE__ */ u2("div", { class: "history-controls", children: [
      /* @__PURE__ */ u2("button", { type: "button", name: "back", title: "Back five minutes", "aria-label": "Back five minutes", children: "\u21B6" }),
      /* @__PURE__ */ u2(
        "button",
        {
          type: "button",
          name: "forward",
          title: "Forward five minutes",
          "aria-label": "Forward five minutes",
          children: "\u21B7"
        }
      ),
      /* @__PURE__ */ u2("button", { type: "button", name: "play", "aria-label": "Play replay", children: "\u25B6" }),
      /* @__PURE__ */ u2(
        "button",
        {
          type: "button",
          name: "latest",
          title: "Follow live events and BlueMap player positions",
          "aria-label": "Follow live",
          children: "NOW"
        }
      ),
      /* @__PURE__ */ u2(SpeedControl, {})
    ] })
  ] });

  // src/ui/replay-panel-view.tsx
  var ReplayPanelView = () => /* @__PURE__ */ u2(S, { children: [
    /* @__PURE__ */ u2("button", { type: "button", name: "open", "aria-expanded": "false", "aria-controls": "history-transport", children: "\u25F7 History" }),
    /* @__PURE__ */ u2("section", { id: "history-transport", hidden: true, "aria-label": "Player history", children: [
      /* @__PURE__ */ u2(HistoryHeader, {}),
      /* @__PURE__ */ u2(HistoryTransport, {}),
      /* @__PURE__ */ u2("div", { class: "history-status", role: "status", children: "Live \xB7 local time" })
    ] }),
    /* @__PURE__ */ u2(HistoryChat, {})
  ] });
  var mountReplayPanelView = (root) => {
    R(/* @__PURE__ */ u2(ReplayPanelView, {}), root);
  };
  var unmountReplayPanelView = (root) => {
    R(null, root);
  };

  // src/ui/webchat-feed-view.tsx
  var WebChatFeed = ({ messages }) => /* @__PURE__ */ u2(S, { children: messages.map((message, index) => /* @__PURE__ */ u2("div", { children: [
    message.web ? "[Web] " : "",
    message.name,
    ": ",
    message.message
  ] }, `${message.name}:${message.message}:${index}`)) });
  var renderWebChatFeed = (root, messages) => {
    R(/* @__PURE__ */ u2(WebChatFeed, { messages }), root);
  };

  // src/replay-panel.ts
  var BASE_URL = new URL("player-history/", globalThis.location?.href ?? "http://localhost/");
  var errorMessage = (error) => error instanceof Error ? error.message : String(error);
  var ReplayPanel = class extends HTMLElement {
    historyClient = new HistoryClient(BASE_URL);
    clock = new ReplayClock();
    engine = new ReplayEngine();
    names = /* @__PURE__ */ new Map();
    selection = /* @__PURE__ */ new Set();
    disabledEvents = /* @__PURE__ */ new Set();
    eventTypes = /* @__PURE__ */ new Set();
    events = [];
    rangeEvents = [];
    liveEvents = [];
    livePoints = [];
    manifest;
    integration;
    cache;
    telemetryCache;
    adapter;
    fullTrails = null;
    heatRows = null;
    statusCoordinator;
    mobileQuery;
    controls = new PanelControls(this);
    lifecycle = new PanelLifecycle();
    requests = new RequestCoordinator();
    panelState = createReplayPanelState();
    chatClient;
    chatToken = "";
    requestId = 0;
    lastFrame = 0;
    lastOverlay;
    lastMap;
    loadedBucket;
    pendingBucket;
    heatVersion = 0;
    chatTimer;
    seekTimer;
    trailDataKey = null;
    healthKey = null;
    overlayKeys = {
      event: null,
      heat: null,
      timeline: null,
      trail: null
    };
    eventRevision = 0;
    registryRevision = 0;
    selectionRevision = 0;
    filterRevision = 0;
    healthToken = {};
    trailMode = 6e4;
    get opened() {
      return this.panelState.panel === "open";
    }
    set opened(value) {
      this.panelState.panel = value ? "open" : "closed";
    }
    get isLive() {
      return this.panelState.mode === "live";
    }
    set isLive(value) {
      this.panelState.mode = value ? "live" : "historical";
    }
    get heatEnabled() {
      return this.panelState.heatmap;
    }
    set heatEnabled(value) {
      this.panelState.heatmap = value;
    }
    get chatPinned() {
      return this.panelState.chatPinned;
    }
    set chatPinned(value) {
      this.panelState.chatPinned = value;
    }
    get chatLoading() {
      return this.panelState.chatLoading;
    }
    set chatLoading(value) {
      this.panelState.chatLoading = value;
    }
    get liveLoading() {
      return this.panelState.liveLoading;
    }
    set liveLoading(value) {
      this.panelState.liveLoading = value;
    }
    get refreshing() {
      return this.panelState.refreshing;
    }
    set refreshing(value) {
      this.panelState.refreshing = value;
    }
    get hasSavedSelection() {
      return this.panelState.hasSavedSelection;
    }
    set hasSavedSelection(value) {
      this.panelState.hasSavedSelection = value;
    }
    get scrubbing() {
      return this.panelState.scrubbing;
    }
    set scrubbing(value) {
      this.panelState.scrubbing = value;
    }
    q(name) {
      this.controls ??= new PanelControls(this);
      return this.controls.get(name);
    }
    require(selector) {
      const element = this.querySelector(selector);
      if (!element) throw new Error(`Missing replay panel element: ${selector}`);
      return element;
    }
    connectedCallback() {
      this.lifecycle.dispose();
      this.requests.abortAll();
      this.lifecycle = new PanelLifecycle();
      this.requests = new RequestCoordinator();
      this.panelState = createReplayPanelState();
      this.eventRevision = 0;
      this.registryRevision = 0;
      this.selectionRevision = 0;
      this.filterRevision = 0;
      this.overlayKeys = { event: null, heat: null, timeline: null, trail: null };
      mountReplayPanelView(this);
      this.controls = new PanelControls(this);
      const eventControl = this.require(".history-event-control");
      const eventMenu = this.require(".history-event-options");
      eventMenu.setAttribute("popover", "manual");
      eventControl.ontoggle = () => this.showMenu(
        eventMenu,
        this.require(".history-event-control summary"),
        eventControl.open
      );
      this.require("#history-players").setAttribute("popover", "manual");
      this.clock = new ReplayClock();
      const savedRange = preferences.range();
      if (savedRange && savedRange !== "dates" && RANGE_OPTIONS.some(([value]) => value === savedRange))
        this.q("range").value = savedRange;
      const savedDays = preferences.days();
      if (savedDays !== null && Number.isInteger(savedDays) && savedDays > 0 && savedDays <= 36500)
        this.q("days").value = String(savedDays);
      const initialRange = this.q("range").value;
      if (initialRange === "all") this.clock.rangeDuration = Infinity;
      else if (!calendarRange(initialRange, Date.now()))
        this.clock.rangeDuration = Number(initialRange === "custom" ? this.q("days").value : initialRange) * 864e5;
      const savedSpeed = preferences.speed();
      if (savedSpeed !== null && SPEED_OPTIONS.includes(savedSpeed))
        this.clock.playbackRate = savedSpeed;
      this.isLive = true;
      this.liveEvents = [];
      this.livePoints = [];
      this.mobileQuery = matchMedia("(max-width: 600px)");
      this.engine = new ReplayEngine();
      this.names = /* @__PURE__ */ new Map();
      this.selection = /* @__PURE__ */ new Set();
      try {
        const selected = preferences.players();
        if (selected !== null) {
          this.selection = new Set(selected.filter(Number.isFinite));
          this.hasSavedSelection = true;
        }
      } catch {
      }
      this.events = [];
      this.disabledEvents = new Set(DEFAULT_DISABLED_EVENTS);
      try {
        const saved = preferences.hiddenEvents();
        if (Array.isArray(saved))
          this.disabledEvents = new Set(saved.filter((type) => typeof type === "string"));
      } catch {
      }
      this.eventTypes = new Set(KNOWN_EVENT_TYPES);
      this.renderEventFilters();
      const savedTrail = String(preferences.trails());
      this.trailMode = savedTrail === "Infinity" ? Infinity : Number(savedTrail ?? 6e4);
      if (!TRAIL_OPTIONS.some(([value]) => Object.is(value, this.trailMode))) this.trailMode = 6e4;
      this.heatEnabled = preferences.heatmap();
      this.chatPinned = true;
      this.rangeEvents = [];
      this.requestId = 0;
      this.statusCoordinator = new StatusCoordinator(this.require(".history-status"));
      this.chatClient = new ChatClient(() => this.chatToken);
      this.chatToken = preferences.chatToken();
      this.q("webchat").onclick = async () => {
        const box = this.require(".history-chat-panel");
        box.hidden = false;
        this.q("webchat").hidden = true;
        this.q("webchat").setAttribute("aria-expanded", "true");
        if (this.mobileQuery.matches) {
          if (this.opened) this.close();
          this.q("open").hidden = true;
        }
        await this.refresh(true);
        await this.loadRangeEvents();
        this.updateOverlays();
        this.lifecycle.clearInterval(this.chatTimer);
        this.pollChat();
        this.chatTimer = this.lifecycle.interval(() => this.pollChat(), 2e3);
      };
      this.q("chat-close").onclick = () => this.closeChat();
      this.q("chat-connect").onclick = async () => {
        try {
          const pair = await this.chatClient.pair();
          this.chatToken = pair.token;
          preferences.saveChatToken(pair.token);
          this.q("chat-status").textContent = `Run /webchat link ${pair.code} in Minecraft (expires in 5 minutes).`;
        } catch (error) {
          this.q("chat-status").textContent = errorMessage(error);
        }
      };
      this.q("chat-logout").onclick = async () => {
        try {
          await this.chatClient.logout();
          this.chatToken = "";
          preferences.saveChatToken("");
          this.q("chat-status").textContent = "Logged out";
          this.pollChat();
        } catch (error) {
          this.q("chat-status").textContent = errorMessage(error);
        }
      };
      this.require(".history-chat-form").onsubmit = async (event) => {
        event.preventDefault();
        const input = this.q("chat-message");
        const button = this.require(".history-chat-form button");
        button.disabled = true;
        try {
          await this.chatClient.send(input.value);
          input.value = "";
          await this.pollChat();
        } catch (error) {
          this.q("chat-status").textContent = errorMessage(error);
        } finally {
          button.disabled = false;
        }
      };
      this.q("open").onclick = () => this.open();
      this.q("close").onclick = () => this.close();
      this.q("speed").onchange = () => {
        this.clock.playbackRate = Number(this.q("speed").value);
        preferences.saveSpeed(this.clock.playbackRate);
        this.q("speed-button").title = `Playback speed: ${this.clock.playbackRate}\xD7`;
        this.require(".history-speed-popover").hidden = true;
        this.sync();
      };
      for (const [kind, selector] of [
        ["speed", "data-speed"],
        ["trails", "data-trail"]
      ]) {
        const menu = this.require(`.history-${kind}-popover`);
        const trigger = this.q(`${kind}-button`);
        menu.setAttribute("popover", "manual");
        trigger.onclick = () => {
          const open = menu.hidden;
          this.closeChoices();
          if (open) {
            menu.hidden = false;
            menu.showPopover?.();
            const bounds = trigger.getBoundingClientRect();
            menu.style.left = `${Math.max(8, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
            menu.style.top = `${Math.max(8, bounds.top - menu.offsetHeight - 8)}px`;
          }
          trigger.setAttribute("aria-expanded", String(open));
        };
        menu.querySelectorAll(`[${selector}]`).forEach((button) => {
          button.onclick = () => {
            this.q(kind).value = button.getAttribute(selector) ?? "";
            this.q(kind).onchange?.(new Event("change"));
            menu.querySelectorAll("button").forEach((option) => {
              option.setAttribute("aria-pressed", String(option === button));
            });
            this.closeChoices();
          };
        });
      }
      const rangeMenu = this.require(".history-range-popover");
      rangeMenu.setAttribute("popover", "manual");
      this.q("range-button").onclick = () => {
        const open = rangeMenu.hidden;
        this.closeChoices();
        if (open) {
          const local = (time) => new Date(time - new Date(time).getTimezoneOffset() * 6e4).toISOString().slice(0, 19);
          if (this.manifest) {
            this.q("date-from").value = local(this.clock.from);
            this.q("date-to").value = local(this.clock.to);
          }
          this.showMenu(rangeMenu, this.q("range-button"), true);
        }
      };
      rangeMenu.querySelectorAll("[data-range]").forEach((button) => {
        button.onclick = () => {
          this.q("range").value = button.dataset.range ?? "0.125";
          this.closeChoices();
          void this.changeRange();
        };
      });
      this.require(".history-custom-days").onsubmit = (event) => {
        event.preventDefault();
        this.q("range").value = "custom";
        this.closeChoices();
        void this.changeRange();
      };
      this.require(".history-custom-dates").onsubmit = (event) => {
        event.preventDefault();
        this.q("range").value = "dates";
        void this.changeRange().then(() => this.closeChoices());
      };
      this.q("back").onclick = () => this.seek(this.clock.time - 3e5);
      this.q("forward").onclick = () => this.seek(this.clock.time + 3e5);
      this.q("latest").onclick = () => {
        this.goNow();
      };
      this.q("play").onclick = () => {
        this.isLive = false;
        this.clock.togglePlayback();
        this.seek(this.clock.time);
        this.sync();
      };
      const timeline = this.q("timeline");
      timeline.oninput = () => {
        const value = Number(timeline.value);
        if (value >= Number(timeline.max) - 1) this.goNow();
        else this.seek(this.clock.from + value);
      };
      timeline.onpointerdown = () => {
        this.scrubbing = true;
        this.sync();
      };
      const finishScrub = () => {
        this.scrubbing = false;
        this.sync();
      };
      this.addEventListener("pointerup", finishScrub, { signal: this.lifecycle.signal });
      this.addEventListener("pointercancel", finishScrub, { signal: this.lifecycle.signal });
      timeline.onblur = finishScrub;
      timeline.onkeydown = (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 3e5 : 1e4;
        this.seek(
          event.key === "Home" ? this.clock.from : event.key === "End" ? this.clock.to : this.clock.time + (event.key === "ArrowLeft" ? -step : step)
        );
      };
      timeline.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.seek(this.clock.time + Math.sign(event.deltaY) * (event.shiftKey ? 3e5 : 1e4));
        },
        { passive: false }
      );
      this.q("players").onclick = () => this.togglePlayers();
      this.q("all").onclick = () => {
        this.selection = new Set(this.names.keys());
        this.selectionRevision++;
        preferences.savePlayers(this.selection);
        this.hasSavedSelection = true;
        this.renderPlayers();
        this.updateOverlays();
      };
      this.q("trails").onchange = () => {
        this.trailMode = Number(this.q("trails").value);
        preferences.saveTrails(this.trailMode);
        this.trailDataKey = null;
        this.requests.abort("trails");
        this.fullTrails = null;
        this.sync();
        this.updateOverlays();
      };
      this.q("heat").onclick = () => {
        this.heatEnabled = !this.heatEnabled;
        preferences.saveHeatmap(this.heatEnabled);
        this.requests.abort("heatmap");
        this.sync();
        this.updateOverlays();
        if (this.heatEnabled) this.loadHeat();
      };
      document.addEventListener(
        "pointerdown",
        (event) => {
          if (!(event.target instanceof Node) || !eventControl.contains(event.target instanceof Node ? event.target : null))
            eventControl.open = false;
          if (!this.require(".history-player-control").contains(
            event.target instanceof Node ? event.target : null
          ))
            this.togglePlayers(false);
          for (const kind of ["speed", "trails"]) {
            if (!this.require(`.history-${kind}`).contains(
              event.target instanceof Node ? event.target : null
            )) {
              const menu = this.require(`.history-${kind}-popover`);
              menu.hidePopover?.();
              menu.hidden = true;
              this.q(`${kind}-button`).setAttribute("aria-expanded", "false");
            }
          }
          if (!this.require(".history-range").contains(
            event.target instanceof Node ? event.target : null
          )) {
            rangeMenu.hidePopover?.();
            rangeMenu.hidden = true;
            this.q("range-button").setAttribute("aria-expanded", "false");
          }
        },
        { signal: this.lifecycle.signal }
      );
      this.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape") {
            this.closeChoices();
            this.togglePlayers(false);
            this.q("players").focus();
          }
        },
        { signal: this.lifecycle.signal }
      );
      window.addEventListener("blur", finishScrub, { signal: this.lifecycle.signal });
      this.lastFrame = performance.now();
      this.q("speed").value = String(this.clock.playbackRate);
      this.q("trails").value = String(this.trailMode);
      this.require(".history-chat").addEventListener(
        "scroll",
        (event) => {
          const chat = event.currentTarget;
          this.chatPinned = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 20;
        },
        { signal: this.lifecycle.signal, passive: true }
      );
      this.sync();
      this.lifecycle.frame((time) => this.tickFrame(time));
      this.refresh(true).then(() => this.pollLive());
      this.lifecycle.interval(() => this.pollLive(), 1e3);
      this.lifecycle.interval(() => this.refresh(), 45e3);
    }
    closeChoices() {
      this.require(".history-event-control").open = false;
      for (const kind of ["speed", "trails"]) {
        const menu = this.require(`.history-${kind}-popover`);
        menu.hidePopover?.();
        menu.hidden = true;
        this.q(`${kind}-button`).setAttribute("aria-expanded", "false");
      }
      const rangeMenu = this.require(".history-range-popover");
      rangeMenu.hidePopover?.();
      rangeMenu.hidden = true;
      this.q("range-button").setAttribute("aria-expanded", "false");
    }
    async pollChat() {
      if (this.chatLoading) return;
      this.chatLoading = true;
      try {
        const session = await this.chatClient.session();
        this.q("chat-connect").hidden = session.linked;
        this.q("chat-logout").hidden = !session.linked;
        this.require(".history-chat-form").hidden = !session.linked;
        if (session.linked) this.q("chat-status").textContent = `Connected as ${session.name}`;
        const data = await this.chatClient.feed();
        const feed = this.require(".history-webchat-feed");
        const shouldFollow = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 20;
        renderWebChatFeed(feed, data.messages);
        if (shouldFollow) feed.scrollTop = feed.scrollHeight;
      } catch (error) {
        this.q("chat-status").textContent = errorMessage(error);
      } finally {
        this.chatLoading = false;
      }
    }
    async open() {
      if (this.mobileQuery.matches) this.closeChat();
      this.opened = true;
      if (this.mobileQuery.matches) this.q("webchat").hidden = true;
      this.q("open").hidden = true;
      this.q("open").setAttribute("aria-expanded", "true");
      this.require("section").hidden = false;
      this.q("close").focus();
      this.trailMode = this.trailMode || 6e4;
      this.q("trails").value = String(this.trailMode);
      preferences.saveTrails(this.trailMode);
      this.goNow();
      await this.refresh(true);
    }
    close() {
      this.closeChoices();
      this.opened = false;
      this.lifecycle.clearInterval(this.chatTimer);
      this.clock.isPlaying = false;
      this.togglePlayers(false);
      this.requests.abort("heatmap");
      this.requests.abort("activity");
      this.require("section").hidden = true;
      this.q("open").hidden = false;
      if (this.mobileQuery.matches && this.require(".history-chat-panel").hidden)
        this.q("webchat").hidden = false;
      this.q("open").setAttribute("aria-expanded", "false");
      this.q("open").focus();
    }
    closeChat() {
      this.lifecycle.clearInterval(this.chatTimer);
      this.require(".history-chat-panel").hidden = true;
      this.q("webchat").hidden = false;
      this.q("webchat").setAttribute("aria-expanded", "false");
      if (this.mobileQuery.matches && !this.opened) this.q("open").hidden = false;
    }
    goNow() {
      this.isLive = true;
      this.clock.isPlaying = false;
      if (this.clock.customRange) {
        this.clock.customRange = null;
        const savedRange = preferences.range() || "0.125";
        this.q("range").value = ["dates", "yesterday"].includes(savedRange) ? "0.125" : savedRange;
      }
      if (this.manifest) {
        const latest = Math.max(this.manifest.latestTimestamp, Date.now());
        const calendar = calendarRange(this.q("range").value, latest);
        if (calendar) this.clock.customRange = { from: calendar.from, to: calendar.to };
        this.clock.refresh(this.manifest.earliestTimestamp, latest, true);
        this.clock.seek(this.clock.to);
      }
      this.sync();
      this.render();
      this.updateOverlays();
      this.pollLive();
    }
    togglePlayers(open = this.require("#history-players").hidden === true) {
      this.showMenu(this.require("#history-players"), this.q("players"), open);
      this.q("players").setAttribute("aria-expanded", String(open));
    }
    showMenu(menu, trigger, open) {
      if (!open) {
        menu.hidePopover?.();
        menu.hidden = true;
        return;
      }
      menu.hidden = false;
      menu.showPopover?.();
      const bounds = trigger.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(bounds.top - menu.offsetHeight - 8, innerHeight - menu.offsetHeight - 8))}px`;
    }
    renderPlayers() {
      const list = this.require(".history-player-list");
      renderPlayerFilter(list, {
        names: this.names,
        selected: this.selection,
        onChange: (id, selected) => {
          if (selected) this.selection.add(id);
          else this.selection.delete(id);
          this.selectionRevision++;
          preferences.savePlayers(this.selection);
          this.hasSavedSelection = true;
          this.sync();
          this.updateOverlays();
        }
      });
      this.sync();
    }
    async refresh(reset = false) {
      if (this.refreshing) return;
      this.refreshing = true;
      const controller = this.requests.start("manifest");
      try {
        const m2 = await this.historyClient.manifest(controller.signal);
        const previous = this.manifest;
        const changed = reset || !previous || previous.latestTimestamp !== m2.latestTimestamp || previous.earliestTimestamp !== m2.earliestTimestamp;
        this.manifest = m2;
        this.telemetryCache?.chunks.clear();
        for (const [control, cap] of [
          ["trails", "movement"],
          ["heat", "heatmap"]
        ]) {
          const element = this.q(control);
          if (element) {
            element.disabled = m2.capabilities?.[cap] === false;
            element.title = element.disabled ? `This dataset has no recorded ${cap}` : "";
          }
        }
        if (!this.integration) {
          this.integration = await this.historyClient.integration(controller.signal);
        }
        if (!this.cache || this.cache.duration !== m2.chunkDurationMs) {
          this.cache?.clear();
          this.cache = new ChunkCache(
            new URL("data", BASE_URL).href,
            m2.chunkDurationMs,
            void 0,
            m2.chunkRanges
          );
        }
        this.cache.setAvailableRanges(m2.chunkRanges);
        for (const player of m2.registry.players) {
          if (!this.hasSavedSelection && !this.names.has(player.id)) this.selection.add(player.id);
        }
        this.names = new Map(m2.registry.players.map((player) => [player.id, player.name]));
        this.selection = new Set([...this.selection].filter((id) => this.names.has(id)));
        this.registryRevision++;
        this.selectionRevision++;
        const latest = Math.max(m2.latestTimestamp, Date.now());
        const calendar = calendarRange(this.q("range").value, latest);
        if (calendar) this.clock.customRange = { from: calendar.from, to: calendar.to };
        this.clock.refresh(m2.earliestTimestamp, latest, reset);
        this.renderPlayers();
        if (changed) await this.reloadRange();
        else this.loadActivity();
        this.render();
        this.updateOverlays();
      } catch (error) {
        this.report(error);
      } finally {
        this.requests.finish("manifest", controller);
        this.refreshing = false;
      }
    }
    report(error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        this.statusCoordinator.show("error", errorMessage(error));
    }
    async changeRange() {
      const choice = this.q("range").value;
      if (choice === "custom" && !this.q("days").reportValidity()) return;
      const latest = Math.max(this.manifest?.latestTimestamp ?? 0, Date.now());
      const calendar = calendarRange(choice, latest);
      if (calendar) {
        this.clock.customRange = { from: calendar.from, to: calendar.to };
        this.isLive = calendar.followsLive;
      } else if (choice === "dates") {
        this.isLive = false;
        const from = new Date(this.q("date-from").value).getTime(), to = new Date(this.q("date-to").value).getTime();
        if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
          this.statusCoordinator.show("range", "Choose an end date after the start date.");
          return;
        }
        this.clock.customRange = { from, to };
      } else {
        this.clock.customRange = null;
        this.isLive = true;
      }
      if (!calendar && choice !== "dates")
        this.clock.rangeDuration = choice === "all" ? Infinity : Number(choice === "custom" ? this.q("days").value : choice) * 864e5;
      preferences.saveRange(choice);
      if (choice === "custom") preferences.saveDays(Number(this.q("days").value));
      if (!this.manifest) return;
      this.clock.refresh(
        this.manifest.earliestTimestamp,
        Math.max(this.manifest.latestTimestamp, Date.now())
      );
      this.sync();
      await this.reloadRange();
    }
    async loadActivity() {
      const controller = this.requests.start("activity");
      const { from, to } = this.clock, chart = this.require(".history-histogram");
      const caption = this.require(".history-density-status");
      chart.replaceChildren();
      if (!this.manifest?.activityBucketMs) {
        caption.textContent = "Recording density is not available yet";
        return;
      }
      const count = Math.max(12, Math.min(96, Math.floor((chart.clientWidth || 720) / 10)));
      const bins = Array(count).fill(0), day = 864e5;
      const first = Math.floor(from / day) * day, last = Math.floor(to / day) * day;
      if ((last - first) / day > 2e3) {
        caption.textContent = "Choose a range of up to 2,000 days to show recording density";
        return;
      }
      caption.textContent = "Loading recording density\u2026";
      try {
        for (let start = first; start <= last; start += day) {
          const rows = await this.historyClient.activity(start, controller.signal);
          addActivityBins(bins, rows, from, to);
        }
        if (controller.signal.aborted || !this.opened) return;
        const max = Math.max(0, ...bins);
        renderActivityHistogram(chart, { bins, from, to, formatTime: formatDate });
        const total = Math.round(bins.reduce((a2, b2) => a2 + b2, 0));
        caption.textContent = this.manifest.activityReady === false ? "Recording density \xB7 history is still being indexed" : max ? "Recording density \xB7 all players \xB7 minute-level counts" : "No recorded samples in this range";
        chart.setAttribute(
          "aria-label",
          "Recording density: approximately " + total.toLocaleString() + " samples across " + count + " intervals. Taller bars mean more recorded samples."
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          caption.textContent = errorMessage(error);
      } finally {
        this.requests.finish("activity", controller);
      }
    }
    async reloadRange() {
      this.loadActivity();
      if (!this.cache) return;
      this.cache.clear();
      this.requestId++;
      this.pendingBucket = this.loadedBucket = void 0;
      this.fullTrails = null;
      this.trailDataKey = null;
      this.requests.abort("trails");
      this.requests.abort("heatmap");
      this.heatRows = null;
      this.overlayKeys = { event: null, heat: null, timeline: null, trail: null };
      this.updateOverlays();
      this.loadRangeEvents();
      await this.loadWindow();
      if (this.heatEnabled && this.opened) this.loadHeat();
    }
    sync() {
      const c2 = this.clock, valid = Number.isFinite(c2.time);
      for (const name of ["timeline", "back", "forward", "play", "latest", "trails", "heat"])
        this.q(name).disabled = !valid;
      if (valid) {
        this.q("timeline").max = String(Math.max(1, c2.to - c2.from));
        this.q("timeline").value = String(c2.time - c2.from);
        this.q("timeline").disabled = c2.from === c2.to;
        this.q("timeline").setAttribute("aria-valuetext", formatDate(c2.time));
        this.q("start").textContent = formatDate(c2.from, false);
        this.q("end").textContent = formatDate(c2.to, false);
        this.q("current").textContent = formatDate(c2.time);
        this.q("latest").disabled = this.isLive;
        this.q("latest").setAttribute("aria-pressed", String(this.isLive));
        const tooltip = this.require(".history-tooltip");
        tooltip.hidden = !this.scrubbing;
        tooltip.textContent = formatDate(c2.time);
        tooltip.style.left = `${clamp((c2.time - c2.from) / Math.max(1, c2.to - c2.from) * 100, 14, 86)}%`;
      }
      const rangeLabel = rangeOptionLabel(this.q("range").value);
      this.q("range-label").textContent = rangeLabel;
      this.q("range-button").title = `History range: ${rangeLabel}`;
      this.q("range-button").setAttribute("aria-label", `Choose history range \xB7 ${rangeLabel}`);
      this.require(".history-range-options").querySelectorAll("[data-range]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.range === this.q("range").value));
      });
      this.q("play").textContent = c2.isPlaying ? "\u2161" : "\u25B6";
      this.q("play").setAttribute("aria-label", c2.isPlaying ? "Pause replay" : "Play replay");
      const playerCount = this.selection.size;
      this.q("player-count").textContent = String(playerCount);
      this.q("players").title = `Players \xB7 ${playerCount} selected`;
      this.q("players").setAttribute("aria-label", `Filter players \xB7 ${playerCount} selected`);
      this.q("trails").value = String(this.trailMode);
      const trailLabel = trailDurationLabel(this.trailMode);
      this.q("trail-label").textContent = trailLabel;
      this.q("trails-button").title = `Trails \xB7 ${trailLabel}`;
      this.q("trails-button").setAttribute("aria-label", `Trail duration \xB7 ${trailLabel}`);
      this.q("heat").setAttribute("aria-pressed", String(!!this.heatEnabled));
      this.querySelectorAll("[data-speed]").forEach((button) => {
        button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === c2.playbackRate));
      });
      this.querySelectorAll("[data-trail]").forEach((button) => {
        button.setAttribute("aria-pressed", String(Number(button.dataset.trail) === this.trailMode));
      });
    }
    async goToEvent(event) {
      if (!event?.point) return;
      this.seek(event.point.time);
      const worldKey = this.manifest?.registry?.worlds?.find(
        (world) => world.id === event.point.world
      )?.key;
      const mapId = Object.entries(this.integration?.mapWorlds || {}).find(
        ([, key]) => key === worldKey
      )?.[0];
      if (mapId && mapId !== this.adapter?.mapId && window.bluemap?.switchMap)
        await window.bluemap.switchMap(mapId, false);
      this.adapter?.focusPoint(event.point);
    }
    seek(time) {
      this.isLive = false;
      if (!this.manifest || !Number.isFinite(time)) return;
      this.clock.seek(time);
      this.sync();
      this.render();
      if (!this.cache) return;
      const bucket = Math.floor(this.clock.time / this.cache.duration);
      if (bucket !== this.loadedBucket && bucket !== this.pendingBucket) {
        if (!this.seekTimer)
          this.seekTimer = this.lifecycle.timeout(() => {
            this.seekTimer = void 0;
            this.loadWindow();
          }, 80);
      }
    }
    async loadWindow() {
      if (!this.cache) return;
      const id = ++this.requestId, bucket = Math.floor(this.clock.time / this.cache.duration);
      this.pendingBucket = bucket;
      try {
        const data = await this.cache.window(this.clock.time);
        if (id !== this.requestId) return;
        if (bucket !== Math.floor(this.clock.time / this.cache.duration)) return;
        this.engine.setPoints(data.points);
        this.events = data.events;
        this.eventRevision++;
        this.loadedBucket = bucket;
        this.statusCoordinator.show(
          "context",
          data.points.length ? this.isLive ? "Live \xB7 local time" : "Historical replay \xB7 local time" : "No recorded data in this window"
        );
        this.render();
        this.updateOverlays();
      } catch (error) {
        if (id === this.requestId) this.report(error);
      } finally {
        if (id === this.requestId) {
          this.pendingBucket = void 0;
          if (bucket !== Math.floor(this.clock.time / this.cache.duration) && this.loadedBucket !== Math.floor(this.clock.time / this.cache.duration))
            this.loadWindow();
        }
      }
    }
    tickFrame(time) {
      const delta = Number.isFinite(this.lastFrame) ? Math.max(0, Math.min(time - this.lastFrame, 1e3)) : 0;
      this.lastFrame = time;
      this.lifecycle.frame((t2) => this.tickFrame(t2));
      if (this.manifest && this.cache) {
        if (!this.scrubbing && this.clock.rate) {
          this.clock.tick(delta);
          this.seek(this.clock.time);
        }
        this.render();
        if (!this.lastOverlay || time - this.lastOverlay > 500) {
          this.updateOverlays();
          this.adapter?.layoutEvents();
          this.lastOverlay = time;
        }
      }
    }
    world() {
      if (!this.adapter || !this.manifest) return void 0;
      const mapId = this.adapter.mapId;
      const key = mapId ? this.integration?.mapWorlds?.[mapId] : void 0;
      return this.manifest.registry.worlds.find((world) => world.key === key)?.id;
    }
    render() {
      if (!this.manifest || !this.cache) return;
      try {
        if (!this.adapter) {
          this.adapter = new BlueMapAdapter(window.bluemap, window.BlueMap);
          const manifest = this.manifest;
          const telemetryCache = new TelemetryCache(BASE_URL, manifest.chunkDurationMs);
          this.telemetryCache = telemetryCache;
          this.adapter.stateDetails = async (player, time) => describeState(
            await telemetryCache.at(player, time),
            manifest.registry,
            manifest.capabilities
          );
          this.overlayKeys = { event: null, heat: null, timeline: null, trail: null };
        }
        const world = this.world();
        const ready = Math.floor(this.clock.time / this.cache.duration) === this.loadedBucket;
        const positions = ready && !this.isLive ? [...this.selection].map((id) => this.engine.position(id, this.clock.time)).filter((point) => point !== null && point.world === world).map((point) => ({ ...point, time: this.clock.time })) : [];
        this.adapter.setPlayers(positions, this.names);
        const healthKey = `${Math.floor(this.clock.time / 1e3)}:${positions.map((position) => position.player).join(",")}`;
        if (healthKey !== this.healthKey) {
          this.healthKey = healthKey;
          const token = {};
          this.healthToken = token;
          const telemetryCache = this.telemetryCache;
          if (!telemetryCache) return;
          Promise.all(
            positions.map(
              async (position) => [position.player, await telemetryCache.at(position.player, this.clock.time)]
            )
          ).then((states) => {
            if (this.healthToken !== token || this.isLive) return;
            for (const [player, state] of states)
              this.adapter?.setPlayerVitals(player, state ?? void 0);
          });
        }
        if (world === void 0)
          this.statusCoordinator.show("range", "This map has no matching recorded dimension.");
        if (this.lastMap !== this.adapter.mapId) {
          this.lastMap = this.adapter.mapId;
          this.updateOverlays();
        }
      } catch (error) {
        this.report(error);
      }
    }
    updateOverlays() {
      if (!this.adapter || !this.cache || !this.manifest || !Number.isFinite(this.clock.time)) return;
      const chat = this.require(".history-chat");
      const timeline = this.require(".history-events");
      this.overlayKeys = updateReplayOverlays({
        adapter: this.adapter,
        cache: this.cache,
        clock: this.clock,
        disabledEvents: this.disabledEvents,
        events: this.events,
        eventRevision: this.eventRevision,
        filterRevision: this.filterRevision,
        fullTrails: this.fullTrails,
        heatEnabled: this.heatEnabled,
        heatRows: this.heatRows,
        heatVersion: this.heatVersion,
        isLive: this.isLive,
        liveEvents: this.liveEvents,
        livePoints: this.livePoints,
        manifest: this.manifest,
        names: this.names,
        ...window.bluemap?.mapViewer?.map?.data?.mapDataRoot ? { mapRoot: window.bluemap.mapViewer.map.data.mapDataRoot } : {},
        registryRevision: this.registryRevision,
        rangeEvents: this.rangeEvents,
        selection: this.selection,
        selectionRevision: this.selectionRevision,
        chatPinned: this.chatPinned,
        timelineRoot: timeline,
        chatRoot: chat,
        trailDataKey: this.trailDataKey,
        trailMode: this.trailMode,
        world: this.world(),
        keys: this.overlayKeys,
        timelineWidth: timeline.clientWidth,
        requestTrail: (dataKey) => this.loadTrails(dataKey),
        trailPending: this.requests.pending("trails"),
        schedule: (callback) => this.lifecycle.frame(callback),
        onSelectEvent: (event) => this.goToEvent(event),
        onSeek: (time) => this.seek(time)
      });
      return;
    }
    async pollLive() {
      if (!this.isConnected || this.liveLoading) return;
      this.liveLoading = true;
      const controller = this.requests.start("live");
      try {
        const data = await this.historyClient.live(controller.signal);
        if (!this.isConnected || data.protocolVersion !== 2 || !Number.isFinite(data.generatedAt) || Date.now() - data.generatedAt > 1e4)
          return;
        this.livePoints = Array.isArray(data.points) ? data.points.slice(-2e4) : [];
        this.liveEvents = Array.isArray(data.events) ? data.events.slice(-1e3) : [];
        this.eventRevision++;
        if (!this.manifest) await this.refresh();
        if (this.manifest && data.registry) this.manifest.registry = data.registry;
        for (const player of data.registry?.players || []) {
          if (!this.names.has(player.id)) this.selection.add(player.id);
          this.names.set(player.id, player.name);
        }
        if (this.isLive && this.manifest && this.cache) {
          this.clock.refresh(
            this.manifest.earliestTimestamp,
            Math.max(this.manifest.latestTimestamp, data.generatedAt, Date.now())
          );
          this.clock.seek(this.clock.to);
          this.sync();
          this.render();
          this.updateOverlays();
          const bucket = Math.floor(this.clock.time / this.cache.duration);
          if (bucket !== this.loadedBucket && bucket !== this.pendingBucket) this.loadWindow();
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          this.statusCoordinator.show("error", "Live updates unavailable");
      } finally {
        this.requests.finish("live", controller);
        this.liveLoading = false;
      }
    }
    renderEventFilters() {
      const list = this.require(".history-event-filter-list");
      renderEventFilter(list, {
        types: this.eventTypes,
        disabled: this.disabledEvents,
        onChange: (type, visible) => {
          if (visible) this.disabledEvents.delete(type);
          else this.disabledEvents.add(type);
          this.filterRevision++;
          try {
            preferences.saveHiddenEvents(this.disabledEvents);
          } catch {
          }
          this.updateOverlays();
        }
      });
    }
    async loadRangeEvents() {
      if (!this.cache || !this.manifest) return;
      const controller = this.requests.start("range-events");
      const duration = this.cache.duration;
      const first = Math.floor(this.clock.from / duration) * duration;
      const last = Math.floor(this.clock.to / duration) * duration;
      const chunks = Math.floor((last - first) / duration) + 1;
      if (chunks > 5e3) {
        this.rangeEvents = [];
        this.eventRevision++;
        this.statusCoordinator.show(
          "range",
          "Event and chat history needs a range under 5,000 chunks"
        );
        return;
      }
      const events = [];
      try {
        for (let time = first; time <= last; time += duration) {
          const data = await this.cache.read(time, controller.signal);
          events.push(...data.events);
          if (events.length > 1e5) throw Error("Too many events in this range");
        }
        if (controller.signal.aborted) return;
        this.rangeEvents = events.sort((a2, b2) => a2.point.time - b2.point.time);
        this.eventRevision++;
        this.overlayKeys.timeline = null;
        this.overlayKeys.event = null;
        this.updateOverlays();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) this.report(error);
      } finally {
        this.requests.finish("range-events", controller);
      }
    }
    async loadTrails(dataKey) {
      if (!this.cache) return;
      const cache = this.cache;
      const controller = this.requests.start("trails");
      const duration = cache.duration;
      const from = this.trailMode === Infinity ? this.clock.from : Math.max(
        this.clock.from,
        Math.floor(this.clock.time / duration) * duration - (this.trailMode || 3e4)
      );
      const to = this.trailMode === Infinity ? this.clock.to : Math.min(this.clock.to, (Math.floor(this.clock.time / duration) + 1) * duration);
      const points = [], events = [];
      let previousPlayers = /* @__PURE__ */ new Set();
      this.statusCoordinator.show("loading", "Loading trails\u2026");
      try {
        if (Math.floor(to / duration) - Math.floor(from / duration) + 1 > 5e3)
          throw Error(
            "Full trails exceed 5,000 recording chunks. Choose a shorter range or 30s / 5m trails."
          );
        for (let t2 = Math.floor(from / duration) * duration; t2 <= to; t2 += duration) {
          const data = await cache.read(t2, controller.signal), seen = /* @__PURE__ */ new Set();
          events.push(...data.events);
          if (events.length > 1e5)
            throw Error("Too many events in this range. Choose a shorter trail duration.");
          for (const point of data.points) {
            seen.add(point.player);
            if (point.flags & CONTEXT && t2 !== Math.floor(from / duration) * duration) continue;
            points.push(
              !previousPlayers.has(point.player) ? { ...point, flags: point.flags | BREAK } : point
            );
            previousPlayers.add(point.player);
            if (points.length > 1e5)
              throw Error("Full trails exceed the browser limit. Use 30s or 5m trails.");
          }
          previousPlayers = seen;
        }
        if (controller.signal.aborted) return;
        this.trailDataKey = dataKey;
        let added = false;
        for (const event of events)
          if (!this.eventTypes.has(event.type)) {
            this.eventTypes.add(event.type);
            added = true;
          }
        if (added) this.renderEventFilters();
        this.fullTrails = new ReplayEngine(points.sort((a2, b2) => a2.time - b2.time));
        this.statusCoordinator.show(
          "context",
          this.isLive ? "Live \xB7 local time" : "Historical replay \xB7 local time"
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          this.report(error);
          this.trailMode = 0;
          this.sync();
        }
      } finally {
        if (this.requests.current("trails", controller)) {
          if (this.fullTrails) this.updateOverlays();
        }
        this.requests.finish("trails", controller);
      }
    }
    async loadHeat() {
      if (!this.manifest) return;
      const manifest = this.manifest;
      const controller = this.requests.start("heatmap");
      try {
        const plan = heatmapPlan(this.clock.from, this.clock.to, manifest.chunkDurationMs), cells = /* @__PURE__ */ new Map();
        for (const part of plan) {
          for (const row of await this.historyClient.heatmap(
            part.level,
            part.time,
            controller.signal
          )) {
            const key = row.slice(0, 4).join(":"), old = cells.get(key);
            if (old) old[4] += row[4];
            else cells.set(key, [...row]);
            if (cells.size > 1e5) throw Error("Heatmap exceeds the browser cell limit.");
          }
        }
        if (controller.signal.aborted || !this.opened) return;
        this.heatRows = [...cells.values()];
        this.heatVersion = (this.heatVersion || 0) + 1;
        this.statusCoordinator.show(
          "context",
          cells.size ? "Heatmap \xB7 time spent \xB7 completed recording chunks" : "No completed heatmap data in this range"
        );
        this.updateOverlays();
      } catch (error) {
        this.report(error);
      } finally {
        this.requests.finish("heatmap", controller);
      }
    }
    disconnectedCallback() {
      this.lifecycle.dispose();
      this.requests.abortAll();
      this.cache?.clear();
      this.adapter?.dispose();
      this.adapter = void 0;
      this.telemetryCache = void 0;
      this.cache = void 0;
      unmountReplayPanelView(this);
    }
  };

  // src/player-history.ts
  if (!customElements.get("bluemap-player-replay")) {
    customElements.define("bluemap-player-replay", ReplayPanel);
    document.body.append(document.createElement("bluemap-player-replay"));
  }
})();
