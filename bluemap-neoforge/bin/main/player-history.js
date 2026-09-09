"use strict";
(() => {
  // src/event-layout.ts
  var overlaps = (box, x, y, width, height) => Math.abs(box.x - x) < (box.width + width) / 2 + 8 && Math.abs(box.y - y) < (box.height + height) / 2 + 8;
  var candidatesFor = (element, bounds) => {
    const candidates = [];
    if (element.classList?.contains("history-chat-bubble") || String(element.className ?? "").includes("history-chat-bubble")) {
      for (let column = -5; column <= 5; column++) {
        for (let row = -10; row <= 10; row++) {
          if (column || row)
            candidates.push({
              dx: column * (bounds.width + 10),
              dy: row * (bounds.height + 10)
            });
        }
      }
      return candidates.sort(
        (left, right) => Math.hypot(left.dx, left.dy) - Math.hypot(right.dx, right.dy) || Math.abs(left.dx) - Math.abs(right.dx)
      );
    }
    for (let ring = 0; ring < 12; ring++) {
      for (let slot = 0; slot < 16; slot++) {
        const angle = -Math.PI / 2 + slot * Math.PI / 8;
        candidates.push({
          dx: Math.cos(angle) * (48 + ring * 34),
          dy: Math.sin(angle) * (48 + ring * 34)
        });
      }
    }
    return candidates;
  };
  var reserveElement = (occupied, element, protectHead = false) => {
    const bounds = element?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    const extra = protectHead ? 28 : 0;
    occupied.push({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + (bounds.height + extra) / 2,
      width: bounds.width,
      height: bounds.height + extra
    });
  };
  var applyConnector = (marker, candidate, bounds) => {
    marker.offsetX = candidate.dx;
    marker.offsetY = candidate.dy;
    marker.element.style.translate = `${candidate.dx}px ${candidate.dy}px`;
    const distance = Math.hypot(candidate.dx, candidate.dy);
    const horizontal = distance ? Math.abs(candidate.dx / distance) : 0;
    const vertical = distance ? Math.abs(candidate.dy / distance) : 0;
    const edge = Math.min(
      horizontal ? bounds.width / 2 / horizontal : Infinity,
      vertical ? bounds.height / 2 / vertical : Infinity
    );
    marker.element.style.setProperty("--connector-start", `${Math.min(edge, distance)}px`);
    marker.element.style.setProperty("--connector-length", `${Math.max(0, distance - edge)}px`);
    marker.element.style.setProperty(
      "--connector-angle",
      `${Math.atan2(-candidate.dy, -candidate.dx)}rad`
    );
  };
  var layoutEventMarkers = (eventMarkers, playerMarkers) => {
    const occupied = [];
    for (const marker of playerMarkers?.markers.values() ?? []) {
      reserveElement(occupied, marker.element);
      reserveElement(occupied, marker.element.querySelector(".history-player-vitals"), true);
    }
    for (const marker of eventMarkers) {
      const bounds = marker.element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const originX = bounds.left + bounds.width / 2 - (marker.offsetX ?? 0);
      const originY = bounds.top + bounds.height / 2 - (marker.offsetY ?? 0);
      const candidate = candidatesFor(marker.element, bounds).find(({ dx, dy }) => {
        const x = originX + dx;
        const y = originY + dy;
        if (x < bounds.width / 2 + 8 || y < bounds.height / 2 + 8 || x > innerWidth - bounds.width / 2 - 8 || y > innerHeight - bounds.height / 2 - 8)
          return false;
        return !occupied.some((box) => overlaps(box, x, y, bounds.width, bounds.height));
      }) ?? { dx: 0, dy: -48 };
      occupied.push({
        x: originX + candidate.dx,
        y: originY + candidate.dy,
        width: bounds.width,
        height: bounds.height
      });
      applyConnector(marker, candidate, bounds);
    }
  };

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
    return Array.from({ length: slots }, (_, index) => {
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
      Math.min(1, delta.reduce((sum, value, i) => sum + value * (offset[i] ?? 0), 0) / length)
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
      for (const p of positions) {
        const id = `p${p.player}`;
        keep.add(id);
        let marker = this.players.markers.get(id);
        if (!marker) {
          marker = new this.api.HtmlMarker(id);
          marker.anchor.set(14, 14);
          marker.element.className = "history-player";
          const head = document.createElement("img");
          head.alt = "Player skin head";
          head.draggable = false;
          const uuid = players.find((player) => player.id === p.player)?.uuid;
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
        marker.element.dataset.historyTooltip = `\u265F ${names.get(p.player) || p.player}
\u25F7 ${formatTimestamp(p.time)}
\u2316 ${formatCoordinates(p)}`;
        marker.element.dataset.player = String(p.player);
        marker.element.dataset.time = String(p.time);
        marker.element.setAttribute("aria-label", marker.element.dataset.historyTooltip);
        marker.element.style.borderColor = playerColor(p.player);
        marker.position.set(p.x / 32, p.y / 32, p.z / 32);
      }
      for (const [id, m] of this.players.markers)
        if (!keep.has(id)) {
          this.players.remove(m);
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
      for (let i = 0; i < segments.length; i++) {
        const marker = new this.api.LineMarker(`trail${i}`);
        marker.line.depthTest = false;
        marker.line.linewidth = 3;
        marker.line.opacity = 1;
        const segment = segments[i];
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
        const p = event.point;
        const key = `group:${p.player}:${p.world}:${Math.round(p.x / 256)}:${Math.round(p.y / 256)}:${Math.round(p.z / 256)}`;
        const bucket = grouped.get(key) ?? [];
        bucket.push(event);
        grouped.set(key, bucket);
      }
      const keep = /* @__PURE__ */ new Set();
      for (const bucket of grouped.values()) {
        bucket.sort((a, b) => a.point.time - b.point.time);
        const e = bucket.at(-1);
        if (!e) continue;
        const key = bucket.length === 1 ? JSON.stringify([e.point, e.type, e.payload]) : JSON.stringify([
          "group",
          ...bucket.map((item) => [item.point.time, item.type, item.payload])
        ]);
        keep.add(key);
        let m = this.eventMarkers.get(key);
        if (!m) {
          m = new this.api.HtmlMarker(`event${this.nextEventId++}`);
          this.eventMarkers.set(key, m);
          m.anchor.set(16, 16);
          m.element.className = "history-event";
          m.element.style.color = eventColor(e.type);
          m.element.style.borderColor = playerColor(e.point.player);
          const svg = createEventIcon(e.type);
          if (e.type === "CHAT") {
            let payload2 = {};
            try {
              const parsed = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload;
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
                payload2 = parsed;
            } catch {
            }
            m.element.className += " history-chat-bubble";
            const player = registry.players?.find((player2) => player2.id === e.point.player);
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
            meta.textContent = `${names.get(e.point.player) || e.point.player} \xB7 ${formatShortTimestamp(e.point.time)}`;
            const message = document.createElement("span");
            message.textContent = String(payload2?.message || "");
            copy.append(meta, message);
            m.element.append(head, copy);
          } else if (bucket.length > 1) {
            m.element.classList.add("history-event-group");
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
            m.element.append(svg, count, list);
          } else m.element.append(svg);
          if (e.type !== "CHAT" && bucket.length === 1) this.focusTooltip(m.element);
          this.events.add(m);
        }
        const payload = eventDetails(e.payload, registry, e.type);
        if (e.type !== "CHAT" && bucket.length === 1) {
          const label = e.type.toLowerCase().replaceAll("_", " ");
          const showPosition = [
            "BLOCK_BREAK",
            "BLOCK_PLACE",
            "CONTAINER_OPEN",
            "ITEM_PICKUP",
            "ITEM_DROP"
          ].includes(e.type);
          m.element.dataset.historyTooltip = `${names.get(e.point.player) || e.point.player} \xB7 ${label}
${formatTimestamp(e.point.time)}${showPosition ? `
Position: ${formatCoordinates(e.point)}` : ""}${payload ? `
${payload}` : ""}`;
          const player = registry.players?.find((player2) => player2.id === e.point.player);
          const root = this.app.mapViewer.map?.data?.mapDataRoot;
          m.element.dataset.historyHead = player?.uuid && root ? `${root}/assets/playerheads/${player.uuid}.png` : FALLBACK_HEAD;
        } else {
          delete m.element.dataset.historyTooltip;
          delete m.element.dataset.historyHead;
        }
        m.element.onclick = (event) => {
          event?.stopPropagation?.();
          if (m.element.querySelector?.(".history-event-list")) this.expandEventGroup(m);
          else if (e.type !== "CHAT") m.element.focus?.();
        };
        if (e.type !== "CHAT") {
          m.element.tabIndex = 0;
          m.element.setAttribute("role", "button");
        }
        if (bucket.length > 1) {
          m.element.setAttribute("aria-expanded", "false");
          m.element.setAttribute("aria-label", `${bucket.length} events; click to expand`);
        } else if (m.element.dataset.historyTooltip)
          m.element.setAttribute("aria-label", m.element.dataset.historyTooltip);
        m.element.onkeydown = (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            m.element.click();
          }
        };
        m.position.set(e.point.x / 32, e.point.y / 32, e.point.z / 32);
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
      layoutEventMarkers(this.eventMarkers.values(), this.players);
    }
    setHeatmap(rows, size, opacity) {
      this.clearHeatmap();
      if (!rows.length) return;
      const T = this.api.Three, positions = [], colors = [], max = rows.reduce((max2, r) => Math.max(max2, r[4]), 0);
      const height = this.app.mapViewer.controlsManager?.position?.y ?? 64;
      for (const row of rows) {
        const x = row[2] * size, z = row[3] * size, value = Math.log1p(row[4]) / Math.log1p(max), c = new T.Color().setHSL((1 - value) * 0.65, 1, 0.5);
        for (const [dx, dz] of [
          [0, 0],
          [1, 1],
          [1, 0],
          [0, 0],
          [0, 1],
          [1, 1]
        ]) {
          positions.push(x + dx * size, height, z + dz * size);
          colors.push(c.r, c.g, c.b);
        }
      }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
      const material = new T.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        side: T.DoubleSide
      });
      this.heat = new T.Mesh(geometry, material);
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
      if (!response.json) throw new Error("Web chat returned an invalid response");
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

  // src/panel-template.ts
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
  var SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];
  var renderPanelTemplate = () => `<button name="open" aria-expanded="false" aria-controls="history-transport">\u25F7 History</button>
<section id="history-transport" hidden aria-label="Player history">
  <div class="history-heading"><span>\u25F7 History</span>
    <label class="history-range">Range <select name="range" aria-label="History range"><option value="0.041666666666666664">Last hour</option><option value="0.125" selected>Last 3 hours</option><option value="0.25">Last 6 hours</option><option value="1">Last 24 hours</option><option value="2">Last 48 hours</option><option value="7">Last week</option><option value="30">Last 30 days</option><option value="all">All history</option><option value="custom">Last N days\u2026</option><option value="dates">Custom dates\u2026</option></select></label>
    <form class="history-custom-days" hidden><label>Last <input name="days" aria-label="Number of days" type="number" min="1" max="36500" step="1" value="14" required> days</label><button type="submit">Apply</button></form>
    <output name="current">\u2014</output><button name="compact" aria-label="Expand controls" aria-expanded="false">\u2303</button><button name="close" aria-label="Close history">\xD7</button></div>
  <form class="history-custom-dates" hidden><label>From <input name="date-from" type="datetime-local" step="1" required></label><label>To <input name="date-to" type="datetime-local" step="1" required></label><button type="submit">Apply dates</button></form>
  <div class="history-dates"><span name="start">\u2014</span><span name="end">\u2014</span></div>
  <div class="history-timeline"><div class="history-histogram" aria-label="Recording density across the selected range"></div><input name="timeline" type="range" min="0" max="1" step="1" value="1" aria-label="Replay timeline"><output class="history-tooltip" hidden></output><div class="history-events" aria-label="Events in loaded replay window"></div></div>
  <div class="history-density-status" hidden role="status">Recording density \xB7 all players \xB7 1-minute resolution</div>
  <div class="history-controls">
    <button name="back" title="Back five minutes" aria-label="Back five minutes">\u21B6</button>
    <div class="history-shuttle-wrap"><div name="shuttle" class="history-shuttle" role="slider" tabindex="0" aria-label="Hold to rewind or fast forward; release to restore playback" aria-valuemin="-120" aria-valuemax="120" aria-valuenow="1"><span>\u2212120\xD7</span><div class="history-shuttle-track"><i></i></div><span>120\xD7</span></div><output name="rate">Shuttle \xB7 1\xD7</output></div>
    <button name="forward" title="Forward five minutes" aria-label="Forward five minutes">\u21B7</button>
    <button name="play" aria-label="Play replay">\u25B6</button><button name="latest" title="Follow live events and BlueMap player positions" aria-label="Follow live">NOW</button>
    <div class="history-speed"><button name="speed-button" type="button" aria-label="Playback speed" title="Playback speed" aria-expanded="false">\u23F1</button><div class="history-speed-popover history-popover history-choices" hidden>${SPEED_OPTIONS.map((rate) => `<button type="button" data-speed="${rate}" aria-pressed="${rate === 1}">${rate}\xD7</button>`).join("")}<input name="speed" type="hidden" value="1"></div></div>
    <div class="history-secondary"><div class="history-trails"><button name="trails-button" aria-label="Trail duration" title="Trails" aria-expanded="false">\u2301</button><div class="history-trails-popover history-popover history-choices" hidden>${TRAIL_OPTIONS.map(([value, label]) => `<button type="button" data-trail="${value}" aria-pressed="${value === 6e4}">${label}</button>`).join("")}<input name="trails" type="hidden" value="60000"></div></div>
      <div class="history-player-control"><button name="players" aria-expanded="false" aria-controls="history-players" aria-label="Filter players" title="Players">\u2659</button><div id="history-players" class="history-popover" hidden><div class="history-popover-heading">Players<button name="all">Select all</button></div><div class="history-player-list"></div></div></div>
      <details class="history-event-control"><summary aria-label="Event filters" title="Event filters">\u2699</summary><div class="history-event-options history-popover"><div class="history-event-filter-list"></div><small>Unchecked types are hidden from this viewer.</small></div></details><button name="heat" aria-pressed="false" title="Time spent in the replay range; completed recording chunks" aria-label="Heatmap">\u25A6</button><button name="webchat" aria-label="Web chat" title="Web chat">\u260F</button></div>
  </div>
  <div class="history-webchat" hidden><div class="history-webchat-feed" aria-live="polite"></div><button name="chat-connect">Connect Minecraft account</button><button name="chat-logout" hidden>Log out</button><output name="chat-status"></output><form class="history-chat-form" hidden><input name="chat-message" aria-label="Chat message" maxlength="256" placeholder="Message the server\u2026" required><button type="submit">Send</button></form></div><div class="history-chat" aria-live="polite" aria-label="Chat history for selected range"></div><div class="history-status" role="status">Live \xB7 local time</div>
</section>
<aside class="history-chat-panel" hidden aria-label="Web chat"><div class="history-chat-heading"><strong>Chat</strong><button name="chat-close" aria-label="Close chat">\xD7</button></div><div class="history-chat-content"></div></aside>`;
  var ICONS = {
    players: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    webchat: "M21 11a8 8 0 0 1-8 8H7l-5 3V11a9 9 0 0 1 19 0Z",
    "trails-button": "M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M19 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4M7 17c4 0 3-10 8-10h2",
    "speed-button": "M3 18a10 10 0 1 1 18 0M12 14l5-6M5 18h14",
    heat: "M4 4h5v5H4zM10 4h5v5h-5zM16 4h4v5h-4zM4 10h5v5H4zM10 10h5v5h-5zM16 10h4v5h-4zM4 16h5v4H4zM10 16h5v4h-5zM16 16h4v4h-4z"
  };
  var iconMarkup = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  var initializePanelIcons = (root) => {
    for (const [name, path] of Object.entries(ICONS)) {
      const element = root.querySelector(`[name="${name}"]`);
      if (!element) throw new Error(`Missing panel control: ${name}`);
      element.innerHTML = iconMarkup(path);
    }
    const summary = root.querySelector(".history-event-control summary");
    if (!summary) throw new Error("Missing event filter summary");
    summary.innerHTML = iconMarkup(
      "M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42m0-12.72-1.42 1.42M7.06 16.94l-1.42 1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0"
    );
  };

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
    players: () => readArray(KEYS.players).filter((value) => Number.isFinite(value)),
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
    constructor(base, duration, fetcher = (...args) => fetch(...args)) {
      this.base = base;
      this.duration = duration;
      this.fetcher = fetcher;
    }
    base;
    duration;
    cache = /* @__PURE__ */ new Map();
    fetcher;
    generation = 0;
    controller;
    async read(start, signal) {
      const cached = this.cache.get(start);
      if (cached) return cached;
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
      this.cache.set(start, chunk);
      while (this.cache.size > 3) {
        const oldest = this.cache.keys().next().value;
        if (oldest === void 0) break;
        this.cache.delete(oldest);
      }
      return chunk;
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
  var SHUTTLE_STOPS = [
    [-1, -120],
    [-0.85, -60],
    [-0.7, -16],
    [-0.5, -4],
    [-0.35, -2],
    [-0.25, -1],
    [-0.16, 0],
    [-0.1, 0.5],
    [0, 1],
    [0.25, 2],
    [0.5, 4],
    [0.7, 16],
    [0.85, 60],
    [1, 120]
  ];
  var shuttleRate = (position) => {
    const value = clamp(position, -1, 1);
    for (let index = 1; index < SHUTTLE_STOPS.length; index++) {
      const previous = SHUTTLE_STOPS[index - 1];
      const current = SHUTTLE_STOPS[index];
      if (!previous || !current) continue;
      const [from, rate] = previous;
      const [to, nextRate] = current;
      if (value <= to) return rate + (nextRate - rate) * (value - from) / (to - from);
    }
    return 120;
  };
  var ReplayClock = class {
    playbackRate = 1;
    rangeDuration = HISTORY_WINDOW;
    customRange = null;
    isPlaying = false;
    isShuttling = false;
    shuttleRate = 1;
    from = 0;
    to = 0;
    time = Number.NaN;
    get atLatest() {
      return Number.isFinite(this.time) && this.to - this.time <= 1e3;
    }
    get rate() {
      if (this.isShuttling) return this.shuttleRate;
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
      if (!this.isShuttling && this.time >= this.to) this.isPlaying = false;
    }
    shuttle(position) {
      this.isShuttling = true;
      this.shuttleRate = shuttleRate(position);
    }
    release() {
      this.isShuttling = false;
      this.shuttleRate = 1;
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

  // src/replay-panel.ts
  var BASE_URL = new URL("player-history/", globalThis.location?.href ?? "http://localhost/");
  var formatDate = (time, seconds = true) => new Date(time).toLocaleString(void 0, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...seconds ? { second: "2-digit" } : {}
  });
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
    status;
    mobileQuery;
    listeners = new AbortController();
    chatClient;
    chatToken = "";
    compact = false;
    opened = false;
    isLive = true;
    heatEnabled = false;
    chatPinned = true;
    chatLoading = false;
    liveLoading = false;
    refreshing = false;
    hasSavedSelection = false;
    scrubbing = false;
    requestId = 0;
    lastFrame = 0;
    lastOverlay;
    lastMap;
    loadedBucket;
    pendingBucket;
    shuttlePointer;
    heatVersion = 0;
    frame;
    liveTimer;
    refreshTimer;
    chatTimer;
    seekTimer;
    eventKey = null;
    trailKey = null;
    trailDataKey = null;
    heatKey = null;
    healthKey = null;
    timelineEventKey = null;
    chatFeedKey;
    healthToken = {};
    trailMode = 6e4;
    liveAbort;
    manifestAbort;
    heatAbort;
    trailAbort;
    rangeEventAbort;
    activityAbort;
    releaseShuttle = () => {
    };
    q(name) {
      return this.require(`[name="${name}"]`);
    }
    require(selector) {
      const element = this.querySelector(selector);
      if (!element) throw new Error(`Missing replay panel element: ${selector}`);
      return element;
    }
    connectedCallback() {
      this.innerHTML = renderPanelTemplate();
      initializePanelIcons(this);
      const eventControl = this.require(".history-event-control");
      const heading = this.require(".history-heading");
      const headerTools = document.createElement("div");
      headerTools.className = "history-header-tools";
      for (const selector of [".history-trails", ".history-player-control", '[name="heat"]'])
        headerTools.append(this.require(selector));
      headerTools.append(eventControl);
      heading.insertBefore(headerTools, this.q("compact"));
      const secondary = this.require(".history-secondary");
      const chatLauncher = this.q("webchat");
      chatLauncher.classList.add("history-chat-launcher");
      chatLauncher.setAttribute("aria-controls", "history-chat-panel");
      chatLauncher.setAttribute("aria-expanded", "false");
      this.append(chatLauncher);
      const chatPanel = this.require(".history-chat-panel");
      chatPanel.id = "history-chat-panel";
      const chatContent = this.require(".history-chat-content");
      const webchat = this.require(".history-webchat");
      webchat.hidden = false;
      chatContent.append(this.require(".history-chat"), webchat);
      secondary.remove();
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
      if (savedRange && savedRange !== "dates" && [...this.q("range").options].some((option) => option.value === savedRange))
        this.q("range").value = savedRange;
      const savedDays = preferences.days();
      if (savedDays !== null && Number.isInteger(savedDays) && savedDays > 0 && savedDays <= 36500)
        this.q("days").value = String(savedDays);
      const initialRange = this.q("range").value;
      this.clock.rangeDuration = initialRange === "all" ? Infinity : Number(initialRange === "custom" ? this.q("days").value : initialRange) * 864e5;
      const savedSpeed = preferences.speed();
      if (savedSpeed !== null && [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64].includes(savedSpeed))
        this.clock.playbackRate = savedSpeed;
      this.isLive = true;
      this.liveEvents = [];
      this.livePoints = [];
      this.mobileQuery = matchMedia("(max-width: 600px)");
      this.compact = this.mobileQuery.matches;
      this.classList.toggle("compact", this.compact);
      this.q("compact").onclick = () => {
        this.closeChoices();
        this.compact = !this.compact;
        this.classList.toggle("compact", this.compact);
        this.q("compact").setAttribute("aria-expanded", String(!this.compact));
        this.q("compact").setAttribute(
          "aria-label",
          this.compact ? "Expand controls" : "Collapse controls"
        );
        this.q("compact").textContent = this.compact ? "\u2303" : "\u2304";
        this.sync();
      };
      this.mobileQuery.addEventListener?.("change", (event) => {
        this.compact = event.matches;
        this.classList.toggle("compact", this.compact);
        this.q("compact").setAttribute("aria-expanded", String(!this.compact));
        this.q("compact").setAttribute(
          "aria-label",
          this.compact ? "Expand controls" : "Collapse controls"
        );
        this.q("compact").textContent = this.compact ? "\u2303" : "\u2304";
        this.sync();
      });
      this.engine = new ReplayEngine();
      this.names = /* @__PURE__ */ new Map();
      this.selection = /* @__PURE__ */ new Set();
      try {
        const selected = preferences.players();
        if (Array.isArray(selected)) {
          this.selection = new Set(selected.filter(Number.isFinite));
          this.hasSavedSelection = true;
        }
      } catch {
      }
      this.events = [];
      this.disabledEvents = /* @__PURE__ */ new Set([
        "ITEM_PICKUP",
        "ITEM_DROP",
        "BLOCK_PLACE",
        "BLOCK_BREAK",
        "CONTAINER_OPEN",
        "TELEPORT"
      ]);
      try {
        const saved = preferences.hiddenEvents();
        if (Array.isArray(saved))
          this.disabledEvents = new Set(saved.filter((type) => typeof type === "string"));
      } catch {
      }
      this.eventTypes = /* @__PURE__ */ new Set([
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
      ]);
      this.renderEventFilters();
      const savedTrail = String(preferences.trails());
      this.trailMode = savedTrail === "Infinity" ? Infinity : Number(savedTrail ?? 6e4);
      if (!TRAIL_OPTIONS.some(([value]) => Object.is(value, this.trailMode))) this.trailMode = 6e4;
      this.heatEnabled = preferences.heatmap();
      this.chatPinned = true;
      this.rangeEvents = [];
      this.requestId = 0;
      this.status = this.require(".history-status");
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
        clearInterval(this.chatTimer);
        this.pollChat();
        this.chatTimer = window.setInterval(() => this.pollChat(), 2e3);
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
      this.q("range").onchange = () => {
        const custom = this.q("range").value === "custom";
        const dates = this.q("range").value === "dates";
        this.require(".history-custom-dates").hidden = !dates;
        if (dates) {
          const local = (t) => new Date(t - new Date(t).getTimezoneOffset() * 6e4).toISOString().slice(0, 19);
          if (this.manifest) {
            this.q("date-from").value = local(this.clock.from);
            this.q("date-to").value = local(this.clock.to);
          }
          this.q("date-from").focus();
        }
        this.require(".history-custom-days").hidden = !custom;
        if (custom) this.q("days").focus();
        else if (!dates) this.changeRange();
      };
      this.require(".history-custom-days").onsubmit = (event) => {
        event.preventDefault();
        this.changeRange();
      };
      this.require(".history-custom-dates").onsubmit = (event) => {
        event.preventDefault();
        this.changeRange();
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
      this.addEventListener("pointerup", finishScrub);
      this.addEventListener("pointercancel", finishScrub);
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
      const shuttle = this.q("shuttle");
      const move = (event) => {
        const bounds = this.require(".history-shuttle-track").getBoundingClientRect();
        const position = clamp((event.clientX - bounds.left) / bounds.width * 2 - 1, -1, 1);
        this.clock.shuttle(position);
        shuttle.style.setProperty("--shuttle", `${(position + 1) * 50}%`);
        this.sync();
      };
      shuttle.onpointerdown = (event) => {
        if (!Number.isFinite(this.clock.time)) return;
        if (event.button !== 0 || this.shuttlePointer !== void 0) return;
        event.preventDefault();
        shuttle.focus();
        shuttle.setPointerCapture(event.pointerId);
        this.shuttlePointer = event.pointerId;
        shuttle.classList.add("held");
        move(event);
      };
      shuttle.onpointermove = (event) => {
        if (event.pointerId === this.shuttlePointer) move(event);
      };
      const release = () => {
        this.shuttlePointer = void 0;
        this.clock.release();
        shuttle.classList.remove("held");
        shuttle.style.setProperty("--shuttle", "50%");
        this.sync();
      };
      shuttle.onpointerup = shuttle.onpointercancel = shuttle.onlostpointercapture = release;
      shuttle.onblur = release;
      shuttle.onkeydown = (event) => {
        if (!Number.isFinite(this.clock.time)) return;
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        this.clock.shuttle(event.key === "ArrowLeft" ? -0.5 : 0.5);
        shuttle.style.setProperty("--shuttle", event.key === "ArrowLeft" ? "25%" : "75%");
        this.sync();
      };
      shuttle.onkeyup = release;
      this.releaseShuttle = release;
      this.q("players").onclick = () => this.togglePlayers();
      this.q("all").onclick = () => {
        this.selection = new Set(this.names.keys());
        preferences.savePlayers(this.selection);
        this.hasSavedSelection = true;
        this.renderPlayers();
        this.updateOverlays();
      };
      this.q("trails").onchange = () => {
        this.trailMode = Number(this.q("trails").value);
        preferences.saveTrails(this.trailMode);
        this.trailDataKey = null;
        this.trailAbort?.abort();
        this.fullTrails = null;
        this.sync();
        this.updateOverlays();
      };
      this.q("heat").onclick = () => {
        this.heatEnabled = !this.heatEnabled;
        preferences.saveHeatmap(this.heatEnabled);
        this.heatAbort?.abort();
        this.sync();
        this.updateOverlays();
        if (this.heatEnabled) this.loadHeat();
      };
      this.listeners = new AbortController();
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
        },
        { signal: this.listeners.signal }
      );
      this.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          this.closeChoices();
          this.togglePlayers(false);
          this.releaseShuttle();
          this.q("players").focus();
        }
      });
      window.addEventListener(
        "blur",
        () => {
          finishScrub();
          release();
        },
        { signal: this.listeners.signal }
      );
      this.lastFrame = performance.now();
      this.q("speed").value = String(this.clock.playbackRate);
      this.q("trails").value = String(this.trailMode);
      this.require(".history-chat").addEventListener("scroll", (event) => {
        const chat = event.currentTarget;
        this.chatPinned = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 20;
      });
      this.sync();
      this.frame = requestAnimationFrame((time) => this.tickFrame(time));
      this.refresh(true).then(() => this.pollLive());
      this.liveTimer = window.setInterval(() => this.pollLive(), 1e3);
      this.refreshTimer = window.setInterval(() => this.refresh(), 45e3);
    }
    closeChoices() {
      this.require(".history-event-control").open = false;
      for (const kind of ["speed", "trails"]) {
        const menu = this.require(`.history-${kind}-popover`);
        menu.hidePopover?.();
        menu.hidden = true;
        this.q(`${kind}-button`).setAttribute("aria-expanded", "false");
      }
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
        const key = JSON.stringify(data.messages);
        if (key !== this.chatFeedKey) {
          this.chatFeedKey = key;
          feed.replaceChildren();
          for (const message of data.messages || []) {
            const row = document.createElement("div");
            row.textContent = `${message.web ? "[Web] " : ""}${message.name}: ${message.message}`;
            feed.append(row);
          }
          feed.scrollTop = feed.scrollHeight;
        }
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
      clearInterval(this.chatTimer);
      this.clock.isPlaying = false;
      this.releaseShuttle();
      this.togglePlayers(false);
      this.heatAbort?.abort();
      this.activityAbort?.abort();
      this.require("section").hidden = true;
      this.q("open").hidden = false;
      if (this.mobileQuery.matches && this.require(".history-chat-panel").hidden)
        this.q("webchat").hidden = false;
      this.q("open").setAttribute("aria-expanded", "false");
      this.q("open").focus();
    }
    closeChat() {
      clearInterval(this.chatTimer);
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
        this.q("range").value = preferences.range() || "0.125";
        this.require(".history-custom-dates").hidden = true;
      }
      if (this.manifest) {
        this.clock.refresh(
          this.manifest.earliestTimestamp,
          Math.max(this.manifest.latestTimestamp, Date.now()),
          true
        );
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
      list.replaceChildren();
      for (const [id, name] of this.names) {
        const label = document.createElement("label"), input = document.createElement("input");
        input.type = "checkbox";
        input.checked = this.selection.has(id);
        input.onchange = () => {
          input.checked ? this.selection.add(id) : this.selection.delete(id);
          preferences.savePlayers(this.selection);
          this.hasSavedSelection = true;
          this.sync();
          this.updateOverlays();
        };
        const swatch = document.createElement("i");
        swatch.className = "history-player-color";
        swatch.style.background = playerColor(id);
        label.append(input, swatch, document.createTextNode(name));
        list.append(label);
      }
      this.sync();
    }
    async refresh(reset = false) {
      if (this.refreshing) return;
      this.refreshing = true;
      this.manifestAbort = new AbortController();
      try {
        const m = await this.historyClient.manifest(this.manifestAbort.signal);
        const previous = this.manifest;
        const changed = reset || !previous || previous.latestTimestamp !== m.latestTimestamp || previous.earliestTimestamp !== m.earliestTimestamp;
        this.manifest = m;
        this.telemetryCache?.chunks.clear();
        for (const [control, cap] of [
          ["trails", "movement"],
          ["heat", "heatmap"]
        ]) {
          const element = this.q(control);
          if (element) {
            element.disabled = m.capabilities?.[cap] === false;
            element.title = element.disabled ? `This dataset has no recorded ${cap}` : "";
          }
        }
        if (!this.integration) {
          this.integration = await this.historyClient.integration(this.manifestAbort.signal);
        }
        if (!this.cache || this.cache.duration !== m.chunkDurationMs) {
          this.cache?.clear();
          this.cache = new ChunkCache(new URL("data", BASE_URL).href, m.chunkDurationMs);
        }
        for (const player of m.registry.players) {
          if (!this.hasSavedSelection && !this.names.has(player.id)) this.selection.add(player.id);
        }
        this.names = new Map(m.registry.players.map((player) => [player.id, player.name]));
        this.selection = new Set([...this.selection].filter((id) => this.names.has(id)));
        this.clock.refresh(m.earliestTimestamp, Math.max(m.latestTimestamp, Date.now()), reset);
        this.renderPlayers();
        if (changed) await this.reloadRange();
        else this.loadActivity();
        this.render();
        this.updateOverlays();
      } catch (error) {
        this.report(error);
      } finally {
        this.refreshing = false;
      }
    }
    report(error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        this.status.textContent = errorMessage(error);
    }
    async changeRange() {
      const choice = this.q("range").value;
      if (choice === "custom" && !this.q("days").reportValidity()) return;
      if (choice === "dates") {
        this.isLive = false;
        const from = new Date(this.q("date-from").value).getTime(), to = new Date(this.q("date-to").value).getTime();
        if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
          this.status.textContent = "Choose an end date after the start date.";
          return;
        }
        this.clock.customRange = { from, to };
      } else this.clock.customRange = null;
      if (choice !== "dates")
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
      this.activityAbort?.abort();
      const controller = new AbortController();
      this.activityAbort = controller;
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
        for (let i = 0; i < bins.length; i++) {
          const bar = document.createElement("span");
          bar.style.height = (bins[i] ?? 0) > 0 ? `max(2px, ${(bins[i] ?? 0) / max * 100}%)` : "0";
          bar.title = formatDate(from + (to - from) * i / count) + " \xB7 " + Math.round(bins[i] ?? 0).toLocaleString() + " recorded samples (approx.)";
          chart.append(bar);
        }
        const total = Math.round(bins.reduce((a, b) => a + b, 0));
        caption.textContent = this.manifest.activityReady === false ? "Recording density \xB7 history is still being indexed" : max ? "Recording density \xB7 all players \xB7 minute-level counts" : "No recorded samples in this range";
        chart.setAttribute(
          "aria-label",
          "Recording density: approximately " + total.toLocaleString() + " samples across " + count + " intervals. Taller bars mean more recorded samples."
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          caption.textContent = errorMessage(error);
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
      this.trailAbort?.abort();
      this.heatAbort?.abort();
      this.heatRows = null;
      this.heatKey = this.trailKey = null;
      this.updateOverlays();
      this.loadRangeEvents();
      await this.loadWindow();
      if (this.heatEnabled && this.opened) this.loadHeat();
    }
    sync() {
      const c = this.clock, valid = Number.isFinite(c.time);
      for (const name of ["timeline", "back", "forward", "play", "latest", "trails", "heat"])
        this.q(name).disabled = !valid;
      if (valid) {
        this.q("timeline").max = String(Math.max(1, c.to - c.from));
        this.q("timeline").value = String(c.time - c.from);
        this.q("timeline").disabled = c.from === c.to;
        this.q("timeline").setAttribute("aria-valuetext", formatDate(c.time));
        this.q("start").textContent = formatDate(c.from, false);
        this.q("end").textContent = formatDate(c.to, false);
        this.q("current").textContent = formatDate(c.time);
        this.q("latest").disabled = this.isLive;
        this.q("latest").setAttribute("aria-pressed", String(this.isLive));
        const tooltip = this.require(".history-tooltip");
        tooltip.hidden = !this.scrubbing;
        tooltip.textContent = formatDate(c.time);
        tooltip.style.left = `${clamp((c.time - c.from) / Math.max(1, c.to - c.from) * 100, 14, 86)}%`;
      }
      this.q("play").textContent = c.isPlaying ? "\u2161" : "\u25B6";
      this.q("play").setAttribute("aria-label", c.isPlaying ? "Pause replay" : "Play replay");
      this.q("rate").textContent = c.isShuttling ? `Shuttle \xB7 ${Number(c.shuttleRate.toFixed(1))}\xD7` : `Shuttle \xB7 release to ${c.playbackRate}\xD7`;
      this.q("shuttle").setAttribute("aria-valuenow", c.shuttleRate.toFixed(1));
      this.q("players").title = `Players \xB7 ${this.selection.size} selected`;
      this.q("trails").value = String(this.trailMode);
      this.q("heat").setAttribute("aria-pressed", String(!!this.heatEnabled));
      this.querySelectorAll("[data-speed]").forEach((button) => {
        button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === c.playbackRate));
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
          this.seekTimer = window.setTimeout(() => {
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
        this.loadedBucket = bucket;
        this.status.textContent = data.points.length ? this.isLive ? "Live \xB7 local time" : "Historical replay \xB7 local time" : "No recorded data in this window";
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
      this.frame = requestAnimationFrame((t) => this.tickFrame(t));
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
          this.trailKey = this.eventKey = this.heatKey = null;
        }
        const world = this.world();
        const ready = Math.floor(this.clock.time / this.cache.duration) === this.loadedBucket;
        const positions = ready && !this.isLive ? [...this.selection].map((id) => this.engine.position(id, this.clock.time)).filter((point) => point !== null && point.world === world).map((point) => ({ ...point, time: this.clock.time })) : [];
        this.adapter.setPlayers(positions, this.names);
        const healthKey = JSON.stringify([
          Math.floor(this.clock.time / 1e3),
          positions.map((position) => position.player)
        ]);
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
          this.status.textContent = "This map has no matching recorded dimension.";
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
      const { from, to, time } = this.clock, world = this.world();
      const full = this.trailMode === Infinity;
      const start = full ? from : Math.max(from, time - this.trailMode);
      const dataKey = JSON.stringify([
        String(this.trailMode),
        this.isLive ? Math.floor(from / this.cache.duration) : from,
        this.isLive ? Math.floor(to / this.cache.duration) : to,
        full ? null : Math.floor(time / this.cache.duration)
      ]);
      if (this.trailDataKey !== dataKey && !this.trailAbort) this.loadTrails(dataKey);
      const historyEngine = this.trailDataKey === dataKey ? this.fullTrails : null;
      const engine = this.isLive ? new ReplayEngine(
        mergePoints([
          { points: [...historyEngine?.players.values() || []].flat(), events: [] },
          { points: this.livePoints, events: [] }
        ])
      ) : historyEngine;
      const trailKey = JSON.stringify([
        dataKey,
        start,
        full ? to : time,
        [...this.selection],
        world,
        !!engine,
        [...this.names]
      ]);
      if (trailKey !== this.trailKey) {
        this.trailKey = trailKey;
        this.adapter.setTrails(
          this.trailMode && engine ? [...this.selection].flatMap((id) => engine.trails(id, start, full ? to : time)).filter((line) => line[0]?.world === world) : [],
          this.names
        );
      }
      const combined = new Map(
        [...this.rangeEvents, ...this.events, ...this.isLive ? this.liveEvents : []].map(
          (event) => [JSON.stringify([event.point, event.type, event.payload]), event]
        )
      );
      const selectedTimelineEvents = [...combined.values()].sort((a, b) => a.point.time - b.point.time).filter(
        (event) => this.selection.has(event.point.player) && event.point.time >= from && event.point.time <= to
      );
      const timelineEvents = combineProductionEvents(selectedTimelineEvents).filter(
        (event) => !this.disabledEvents.has(event.type)
      );
      const events = visibleEvents(timelineEvents, {
        from,
        time,
        trailMode: this.trailMode,
        disabled: this.disabledEvents
      }).slice(-500);
      const eventKey = JSON.stringify([events, world, from, to, [...this.names]]);
      if (this.eventKey !== eventKey) {
        this.eventKey = eventKey;
        this.adapter.setEvents(
          events.filter((event) => event.point.world === world),
          this.names,
          (t) => this.seek(t),
          this.manifest.registry
        );
      }
      const chatEvents = selectedTimelineEvents.filter((event) => ["CHAT", "JOIN", "QUIT", "DEATH"].includes(event.type)).slice(-1e3);
      const timelineEventKey = JSON.stringify([chatEvents, from, to, [...this.names]]);
      if (this.timelineEventKey !== timelineEventKey) {
        this.timelineEventKey = timelineEventKey;
        const chat = this.require(".history-chat");
        const follow = this.chatPinned;
        chat.replaceChildren();
        for (const event of chatEvents) {
          const row = document.createElement("div");
          let payload = {};
          try {
            const parsed = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
              payload = parsed;
          } catch {
            continue;
          }
          const time2 = document.createElement("button");
          time2.type = "button";
          time2.className = "history-chat-time";
          time2.title = "Go to this message";
          time2.textContent = formatDate(event.point.time);
          time2.onclick = (click) => {
            click.stopPropagation();
            this.goToEvent(event);
          };
          const head = document.createElement("img");
          head.className = "history-chat-head";
          head.alt = "";
          const player = this.manifest.registry.players.find(
            (player2) => player2.id === event.point.player
          );
          const mapRoot = window.bluemap?.mapViewer?.map?.data?.mapDataRoot;
          if (player?.uuid && mapRoot) head.src = `${mapRoot}/assets/playerheads/${player.uuid}.png`;
          else head.hidden = true;
          head.onerror = () => {
            head.hidden = true;
          };
          const message = document.createElement("span");
          const name = this.names.get(event.point.player) || "Player";
          if (event.type !== "CHAT")
            row.classList.add("history-chat-system", `history-chat-${event.type.toLowerCase()}`);
          message.textContent = chatMessage(event.type, name, payload);
          row.append(time2, head, message);
          row.tabIndex = 0;
          row.setAttribute("role", "button");
          row.title = "Show this message on the map";
          row.onclick = () => this.goToEvent(event);
          row.onkeydown = (key) => {
            if (key.key === "Enter" || key.key === " ") {
              key.preventDefault();
              this.goToEvent(event);
            }
          };
          chat.append(row);
        }
        if (!chatEvents.length) {
          const empty = document.createElement("div");
          empty.className = "history-chat-empty";
          empty.textContent = "No chat or player status messages in this range";
          chat.append(empty);
        }
        if (follow)
          requestAnimationFrame(() => {
            chat.scrollTop = chat.scrollHeight;
          });
        const ticks = this.require(".history-events");
        ticks.replaceChildren();
        const indicatorEvents = chatEvents.filter((event) => ["CHAT", "DEATH"].includes(event.type));
        const threshold = (to - from) * 18 / Math.max(1, ticks.clientWidth || 600);
        for (const cluster of clusterTimelineEvents(indicatorEvents, threshold)) {
          const button = document.createElement("button");
          const hasChat = cluster.some((event) => event.type === "CHAT");
          const hasDeath = cluster.some((event) => event.type === "DEATH");
          button.className = `history-timeline-event ${hasChat && hasDeath ? "history-mixed-tick" : hasDeath ? "history-death-tick" : "history-chat-tick"}`;
          const middle = cluster.reduce((sum, event) => sum + event.point.time, 0) / cluster.length;
          button.style.left = `${(middle - from) / Math.max(1, to - from) * 100}%`;
          button.style.color = hasChat && hasDeath ? "#eee" : eventColor(hasDeath ? "DEATH" : "CHAT");
          const bubble = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h12v9H7l-4 3v-3H2z"/></svg>';
          const skull = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 7a5 5 0 0 1 10 0v4h-2v2H9v-2H7v2H5v-2H3zM5 7h2v2H5zm4 0h2v2H9z"/></svg>';
          button.innerHTML = (hasChat ? bubble : "") + (hasDeath ? skull : "") + (cluster.length > 1 ? `<b>${cluster.length}</b>` : "");
          button.setAttribute(
            "aria-label",
            `${cluster.length} ${hasChat && hasDeath ? "chat and death" : hasDeath ? "death" : "chat"} event${cluster.length === 1 ? "" : "s"}; click repeatedly to cycle`
          );
          let current = 0;
          button.onclick = () => {
            const event = cluster[current++ % cluster.length];
            if (!event) return;
            this.goToEvent(event);
            button.title = `${formatDate(event.point.time)} \xB7 ${event.type.toLowerCase()} \xB7 ${this.names.get(event.point.player) || "Player"}`;
          };
          ticks.append(button);
        }
      }
      const heatKey = JSON.stringify([
        this.heatVersion,
        [...this.selection],
        world,
        this.heatEnabled
      ]);
      if (heatKey !== this.heatKey) {
        this.heatKey = heatKey;
        if (this.heatEnabled && this.heatRows) {
          const cells = /* @__PURE__ */ new Map();
          for (const row of this.heatRows)
            if (this.selection.has(row[0]) && row[1] === world) {
              const key = `${row[2]},${row[3]}`, old = cells.get(key);
              if (old) old[4] += row[4];
              else cells.set(key, [...row]);
            }
          this.adapter.setHeatmap([...cells.values()], this.manifest.cellSize, 0.55);
        } else this.adapter.clearHeatmap();
      }
    }
    async pollLive() {
      if (!this.isConnected || this.liveLoading) return;
      this.liveLoading = true;
      const controller = new AbortController();
      this.liveAbort = controller;
      try {
        const data = await this.historyClient.live(controller.signal);
        if (!this.isConnected || data.protocolVersion !== 2 || !Number.isFinite(data.generatedAt) || Date.now() - data.generatedAt > 1e4)
          return;
        this.livePoints = Array.isArray(data.points) ? data.points.slice(-2e4) : [];
        this.liveEvents = Array.isArray(data.events) ? data.events.slice(-1e3) : [];
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
          this.status.textContent = "Live updates unavailable";
      } finally {
        this.liveLoading = false;
      }
    }
    renderEventFilters() {
      const list = this.require(".history-event-filter-list");
      list.replaceChildren();
      for (const type of this.eventTypes) {
        const label = document.createElement("label"), input = document.createElement("input");
        input.type = "checkbox";
        input.setAttribute("aria-label", type.toLowerCase().replaceAll("_", " "));
        input.checked = !this.disabledEvents.has(type);
        input.onchange = () => {
          if (input.checked) this.disabledEvents.delete(type);
          else this.disabledEvents.add(type);
          try {
            preferences.saveHiddenEvents(this.disabledEvents);
          } catch {
          }
          this.updateOverlays();
        };
        label.append(input, document.createTextNode(type.toLowerCase().replaceAll("_", " ")));
        list.append(label);
      }
    }
    async loadRangeEvents() {
      this.rangeEventAbort?.abort();
      if (!this.cache || !this.manifest) return;
      const controller = new AbortController();
      this.rangeEventAbort = controller;
      const duration = this.cache.duration;
      const first = Math.floor(this.clock.from / duration) * duration;
      const last = Math.floor(this.clock.to / duration) * duration;
      const chunks = Math.floor((last - first) / duration) + 1;
      if (chunks > 5e3) {
        this.rangeEvents = [];
        this.status.textContent = "Event and chat history needs a range under 5,000 chunks";
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
        this.rangeEvents = events.sort((a, b) => a.point.time - b.point.time);
        this.timelineEventKey = null;
        this.eventKey = null;
        this.updateOverlays();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) this.report(error);
      } finally {
        if (this.rangeEventAbort === controller) this.rangeEventAbort = void 0;
      }
    }
    async loadTrails(dataKey) {
      if (!this.cache) return;
      const cache = this.cache;
      const controller = new AbortController();
      this.trailAbort = controller;
      const duration = cache.duration;
      const from = this.trailMode === Infinity ? this.clock.from : Math.max(
        this.clock.from,
        Math.floor(this.clock.time / duration) * duration - (this.trailMode || 3e4)
      );
      const to = this.trailMode === Infinity ? this.clock.to : Math.min(this.clock.to, (Math.floor(this.clock.time / duration) + 1) * duration);
      const points = [], events = [];
      let previousPlayers = /* @__PURE__ */ new Set();
      this.status.textContent = "Loading trails\u2026";
      try {
        if (Math.floor(to / duration) - Math.floor(from / duration) + 1 > 5e3)
          throw Error(
            "Full trails exceed 5,000 recording chunks. Choose a shorter range or 30s / 5m trails."
          );
        for (let t = Math.floor(from / duration) * duration; t <= to; t += duration) {
          const data = await cache.read(t, controller.signal), seen = /* @__PURE__ */ new Set();
          events.push(...data.events);
          if (events.length > 1e5)
            throw Error("Too many events in this range. Choose a shorter trail duration.");
          for (const point of data.points) {
            seen.add(point.player);
            if (point.flags & CONTEXT && t !== Math.floor(from / duration) * duration) continue;
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
        this.fullTrails = new ReplayEngine(points.sort((a, b) => a.time - b.time));
        this.status.textContent = this.isLive ? "Live \xB7 local time" : "Historical replay \xB7 local time";
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          this.report(error);
          this.trailMode = 0;
          this.sync();
        }
      } finally {
        if (this.trailAbort === controller) {
          this.trailAbort = void 0;
          if (this.fullTrails) this.updateOverlays();
        }
      }
    }
    async loadHeat() {
      if (!this.manifest) return;
      const manifest = this.manifest;
      this.heatAbort?.abort();
      const controller = new AbortController();
      this.heatAbort = controller;
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
        this.status.textContent = cells.size ? "Heatmap \xB7 time spent \xB7 completed recording chunks" : "No completed heatmap data in this range";
        this.updateOverlays();
      } catch (error) {
        this.report(error);
      }
    }
    disconnectedCallback() {
      clearInterval(this.chatTimer);
      clearInterval(this.liveTimer);
      clearInterval(this.refreshTimer);
      clearTimeout(this.seekTimer);
      this.liveAbort?.abort();
      this.manifestAbort?.abort();
      this.heatAbort?.abort();
      this.trailAbort?.abort();
      this.rangeEventAbort?.abort();
      this.activityAbort?.abort();
      this.cache?.clear();
      this.adapter?.dispose();
      if (this.frame !== void 0) cancelAnimationFrame(this.frame);
      this.listeners.abort();
    }
  };

  // src/player-history.ts
  if (!customElements.get("bluemap-player-replay")) {
    customElements.define("bluemap-player-replay", ReplayPanel);
    document.body.append(document.createElement("bluemap-player-replay"));
  }
})();
