// Protocol 2 telemetry reconstruction is implemented independently of BlueMap rendering.
export function stateAt(records, player, time) {
  let end = records.length;
  while (end > 0 && records[end - 1].time > time) end--;
  let start = end - 1;
  while (
    start >= 0 &&
    (records[start].player !== player ||
      !["checkpoint", "unknown"].includes(records[start].kind))
  )
    start--;
  if (start < 0 || records[start].kind === "unknown") return null;
  let state = { ...records[start].values };
  for (let index = start + 1; index < end; index++) {
    const record = records[index];
    if (record.player === player && record.kind === "delta")
      Object.assign(state, record.values);
  }
  return state;
}

// Line2 reports its segment index and a world-space closest point on that segment.
export function trailPoint(points, index, hit) {
  if (!Number.isInteger(index) || !hit) return null;
  const a = points?.[index],
    b = points?.[index + 1];
  if (
    !a ||
    !b ||
    a.player !== b.player ||
    a.world !== b.world ||
    b.time < a.time ||
    b.flags & 1 ||
    a.flags & 2
  )
    return null;
  const delta = [b.x - a.x, b.y - a.y, b.z - a.z];
  const length = delta.reduce((sum, n) => sum + n * n, 0);
  const offset = [hit.x * 32 - a.x, hit.y * 32 - a.y, hit.z * 32 - a.z];
  const fraction = length
    ? Math.max(
        0,
        Math.min(
          1,
          delta.reduce((sum, n, i) => sum + n * offset[i], 0) / length,
        ),
      )
    : 0;
  return {
    ...a,
    time: a.time + (b.time - a.time) * fraction,
    x: a.x + delta[0] * fraction,
    y: a.y + delta[1] * fraction,
    z: a.z + delta[2] * fraction,
  };
}

export class TelemetryCache {
  constructor(base, duration, fetcher = (...args) => fetch(...args)) {
    this.base = base;
    this.duration = duration;
    this.fetcher = fetcher;
    this.chunks = new Map();
    this.expires = new Map();
    this.players = new WeakMap();
  }
  async load(time) {
    const start = Math.floor(time / this.duration) * this.duration;
    if ((this.expires.get(start) ?? 0) < Date.now()) this.chunks.delete(start);
    if (!this.chunks.has(start)) {
      this.expires.set(start, Date.now() + 5000);
      const promise = this.fetcher(
        new URL(`data/states/${start}.json`, this.base),
        { cache: "no-store" },
      )
        .then(async (response) => {
          if (response.status === 404) return [];
          if (!response.ok) throw Error("State history unavailable");
          const records = await response.json();
          if (!Array.isArray(records) || records.length > 100000)
            throw Error("Invalid state chunk");
          return records
            .filter(
              (record) =>
                record.time >= start && record.time < start + this.duration,
            )
            .sort((a, b) => a.time - b.time);
        })
        .catch(() => []);
      this.chunks.set(start, promise);
      while (this.chunks.size > 4) {
        const oldest = this.chunks.keys().next().value;
        this.chunks.delete(oldest);
        this.expires.delete(oldest);
      }
    }
    return this.chunks.get(start);
  }
  async at(player, time) {
    const records = await this.load(time);
    let players = this.players.get(records);
    if (!players) {
      players = new Map();
      for (const record of records) {
        if (!players.has(record.player)) players.set(record.player, []);
        players.get(record.player).push(record);
      }
      this.players.set(records, players);
    }
    return stateAt(players.get(player) ?? [], player, time);
  }
}
export function describeState(state, registry, capabilities = {}) {
  if (!state) return "\nNo state recorded at this time";
  const lines = [];
  const fields = [
    ["health", "health", "Health"],
    ["food", "food", "Food"],
    ["xp", "xpLevel", "XP level"],
    ["game-mode", "gameMode", "Game mode"],
  ];
  for (const [cap, key, label] of fields)
    if (capabilities[cap])
      lines.push(
        `${label}: ${state[key] ?? "unknown"}${key === "health" && state.maxHealth != null ? ` / ${state.maxHealth}` : ""}`,
      );
  const item = (value) =>
    !value
      ? "unknown"
      : value.count === 0
        ? "empty"
        : `${readableName(registry.items?.find((row) => row.id === value.item)?.key ?? "unknown item")} ×${value.count}${value.damage ? ` (damage ${value.damage})` : ""}${value.name ? ` · ${value.name}` : ""}`;
  if (capabilities["held-item"]) lines.push(`Held: ${item(state.heldItem)}`);
  if (capabilities.equipment)
    for (const slot of ["head", "chest", "legs", "feet", "offhand"])
      lines.push(`${slot}: ${item(state["equipment:" + slot])}`);
  if (capabilities.effects)
    lines.push(
      `Effects: ${
        state.effects == null
          ? "unknown"
          : Object.entries(state.effects)
              .map(
                ([key, value]) => `${readableName(key)} ${value.amplifier + 1}`,
              )
              .join(", ") || "none"
      }`,
    );
  if (capabilities.inventory) {
    const slots = Object.entries(state).filter(([key]) =>
      key.startsWith("slot:"),
    );
    lines.push(
      `Inventory: ${slots.length ? slots.map(([key, value]) => `${key.slice(5)}: ${item(value)}`).join("; ") : "unknown"}`,
    );
  }
  return lines.length ? "\n" + lines.join("\n") : "";
}

export const readableName = (value) =>
  String(value)
    .replace(/^minecraft:/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
export function eventDetails(payload, registry = {}) {
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return payload.trim() ? "Details unavailable" : "";
    }
  }
  if (!payload || typeof payload !== "object") return "";
  const lines = [];
  const visit = (value, label, depth = 0) => {
    if (depth > 3 || lines.length >= 24) return;
    if (value == null) return;
    if (typeof value === "object") {
      if ("x" in value && "y" in value && "z" in value && "world" in value) {
        const dimension = registry.worlds?.find(
          (w) => w.id === value.world,
        )?.key;
        lines.push(
          `${label}: ${[value.x, value.y, value.z].map((n) => (n / 32).toFixed(1)).join(", ")}${dimension ? " · " + readableName(dimension) : ""}`,
        );
        return;
      }
      for (const [key, item] of Object.entries(value))
        visit(
          item,
          label ? `${label} · ${readableName(key)}` : readableName(key),
          depth + 1,
        );
    } else {
      if (label === "Details Truncated") {
        lines.push("Some details were too large to record");
        return;
      }
      if (label === "Message") {
        lines.push(`Message: ${value}`);
        return;
      }
      if (label === "Item" && typeof value === "number")
        value =
          registry.items?.find((item) => item.id === value)?.key ??
          (value === 0 ? "Empty" : "Unknown item");
      lines.push(
        `${label}: ${typeof value === "boolean" ? (value ? "Yes" : "No") : typeof value === "number" ? Number(value.toFixed(2)) : readableName(value)}`,
      );
    }
  };
  visit(payload, "");
  return lines.join("\n");
}
