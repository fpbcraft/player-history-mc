import { FALLBACK_HEAD } from "./event-presentation.js";
import type { HistoryPoint, HistoryRegistry, PlayerState } from "./types.js";

export interface RosterPlayer {
  point: HistoryPoint;
  name: string;
  uuid?: string | undefined;
  dimension: string;
  offline: boolean;
  state?: PlayerState | undefined;
}

export const dimensionName = (key: string): string =>
  ({
    "minecraft:overworld": "Overworld",
    "minecraft:the_nether": "Nether",
    "minecraft:the_end": "End",
  })[key] ?? key;

export const rosterAction = (state: PlayerState | undefined): string => {
  if (!state) return "";
  for (const [key, label] of [
    ["sleeping", "Sleeping"],
    ["elytra", "Gliding"],
    ["swimming", "Swimming"],
    ["sneaking", "Sneaking"],
    ["sprinting", "Sprinting"],
  ] as const) {
    if (state[key] === true) return label;
  }
  return "";
};

export const rosterHealth = (state: PlayerState | undefined): string => {
  const hp = state?.health;
  const max = state?.maxHealth;
  return typeof hp === "number" &&
    Number.isFinite(hp) &&
    typeof max === "number" &&
    Number.isFinite(max) &&
    max > 0
    ? `${Math.round(hp * 10) / 10} / ${Math.round(max * 10) / 10} HP`
    : "HP unknown";
};

/** Crop the existing global skin, including its hat layer, without a map-local head dependency. */
export const createRosterHead = (uuid?: string): HTMLElement => {
  const face = document.createElement("span");
  face.className = "history-roster-face";
  const image = document.createElement("img");
  image.alt = "";
  image.draggable = false;
  const hat = document.createElement("img");
  hat.alt = "";
  hat.draggable = false;
  hat.className = "history-roster-hat";
  const fallback = () => {
    image.onerror = null;
    hat.onerror = null;
    face.className = "history-roster-face history-roster-fallback";
    hat.hidden = true;
    image.src = FALLBACK_HEAD;
  };
  face.append(image, hat);
  if (uuid) {
    image.onerror = fallback;
    hat.onerror = fallback;
    image.src = new URL(
      `player-history/skins/${encodeURIComponent(uuid)}.png`,
      document.baseURI,
    ).href;
    hat.src = image.src;
  } else fallback();
  return face;
};

export class PlayerRoster {
  private readonly cards = new Map<number, { button: HTMLButtonElement; signature: string }>();
  constructor(
    private readonly root: HTMLElement,
    private readonly select: (row: RosterPlayer) => void,
  ) {
    root.setAttribute("aria-label", "Player roster");
  }

  update(rows: readonly RosterPlayer[]): void {
    const keep = new Set(rows.map((row) => row.point.player));
    for (const [id, card] of this.cards)
      if (!keep.has(id)) {
        card.button.remove();
        this.cards.delete(id);
      }
    for (const row of rows) {
      const id = row.point.player;
      let card = this.cards.get(id);
      if (!card) {
        const button = document.createElement("button");
        button.value = String(id);
        this.root.append(button);
        card = { button, signature: "" };
        this.cards.set(id, card);
      }
      card.button.onclick = () => this.select(row);
      const dimension = dimensionName(row.dimension);
      const health = row.offline ? "Offline · last location" : rosterHealth(row.state);
      const action = row.offline
        ? `Seen ${new Date(row.point.time).toLocaleString()}`
        : rosterAction(row.state);
      const signature = JSON.stringify([row.name, row.uuid, row.dimension, health, action]);
      if (signature === card.signature) continue;
      card.signature = signature;
      card.button.dataset.dimension = row.dimension;
      card.button.dataset.offline = String(row.offline);
      card.button.title = `${row.name} · ${dimension}\n${health}${action ? `\n${action}` : ""}`;
      card.button.setAttribute(
        "aria-label",
        `${row.offline ? "View last location of" : "Follow"} ${row.name}, ${dimension}, ${health}${action ? `, ${action}` : ""}`,
      );
      const labels = [row.name, dimension, health, action].map((text, index) => {
        const label = document.createElement("span");
        label.className =
          [
            "history-roster-name",
            "history-roster-dimension",
            "history-roster-health",
            "history-roster-action",
          ][index] ?? "";
        label.textContent = text;
        return label;
      });
      card.button.replaceChildren(createRosterHead(row.uuid), ...labels);
    }
  }
}

export const rosterPlayers = (
  points: readonly HistoryPoint[],
  registry: HistoryRegistry,
  states: Record<string, PlayerState>,
  offline = false,
): RosterPlayer[] => {
  const players = new Map(registry.players.map((player) => [player.id, player]));
  const worlds = new Map(registry.worlds.map((world) => [world.id, world.key]));
  return points.map((point) => ({
    point,
    name: players.get(point.player)?.name ?? String(point.player),
    uuid: players.get(point.player)?.uuid,
    dimension: worlds.get(point.world) ?? "Unknown dimension",
    offline,
    state: offline ? undefined : states[String(point.player)],
  }));
};
