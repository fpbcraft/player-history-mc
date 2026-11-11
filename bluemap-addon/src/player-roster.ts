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

export const rosterSeen = (time: number, now = Date.now()): string => {
  const date = new Date(time);
  const today = new Date(now);
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
  if (date.toDateString() !== today.toDateString()) {
    options.month = "short";
    options.day = "numeric";
    if (date.getFullYear() !== today.getFullYear()) options.year = "2-digit";
  }
  return `Seen ${new Intl.DateTimeFormat(undefined, options).format(date)}`;
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

interface RosterCard {
  button: HTMLButtonElement;
  signature: string;
  row: RosterPlayer;
}
let nextRoster = 0;

export class PlayerRoster {
  private readonly cards = new Map<number, RosterCard>();
  private readonly details = document.createElement("div");
  private readonly listeners = new AbortController();
  private shown: RosterCard | undefined;
  private pinned = false;
  private expanded = false;
  private touchInput = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly select: (row: RosterPlayer) => void,
  ) {
    root.setAttribute("aria-label", "Player roster");
    root.dataset.expanded = "false";
    root.setAttribute("aria-expanded", "false");
    this.details.className = "history-roster-details";
    this.details.id = `history-roster-details-${++nextRoster}`;
    this.details.setAttribute("role", "tooltip");
    this.details.hidden = true;
    document.body.append(this.details);
    const options = { signal: this.listeners.signal };
    document.addEventListener(
      "pointerdown",
      (event) => {
        const target = event.target as Node | null;
        if (target && !root.contains(target) && !this.details.contains(target))
          this.setExpanded(false);
      },
      options,
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") this.setExpanded(false);
      },
      options,
    );
    root.addEventListener(
      "pointerdown",
      (event) => {
        this.touchInput = event.pointerType === "touch";
      },
      options,
    );
    root.addEventListener(
      "click",
      (event) => {
        if (!this.expanded) {
          event.preventDefault();
          this.setExpanded(true);
        }
      },
      options,
    );
    root.addEventListener("scroll", () => this.positionDetails(), options);
    window.addEventListener("resize", () => this.positionDetails(), options);
  }

  private canHover(): boolean {
    return window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? true;
  }

  private setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.root.dataset.expanded = String(expanded);
    this.root.setAttribute("aria-expanded", String(expanded));
    if (!expanded) this.hideDetails();
  }

  private hideDetails(): void {
    this.shown?.button.removeAttribute("aria-describedby");
    this.shown = undefined;
    this.pinned = false;
    this.details.hidden = true;
  }

  private positionDetails(): void {
    if (!this.shown) return;
    const bounds = this.shown.button.getBoundingClientRect();
    const strip = this.root.getBoundingClientRect();
    if (bounds.right <= strip.left || bounds.left >= strip.right) {
      this.hideDetails();
      return;
    }
    this.details.style.maxWidth = innerWidth <= 600 ? `${Math.max(120, strip.width - 8)}px` : "";
    const width = this.details.offsetWidth;
    const height = this.details.offsetHeight;
    let left = Math.max(
      8,
      Math.min(innerWidth - width - 8, bounds.left + bounds.width / 2 - width / 2),
    );
    if (innerWidth <= 600) left = Math.max(8, Math.min(left, strip.right - width - 4));
    const top =
      bounds.bottom + height + 12 <= innerHeight
        ? bounds.bottom + 8
        : Math.max(8, bounds.top - height - 8);
    this.details.style.left = `${left}px`;
    this.details.style.top = `${top}px`;
  }

  private showDetails(card: RosterCard, pinned = false): void {
    if (this.shown !== card) this.shown?.button.removeAttribute("aria-describedby");
    this.shown = card;
    this.pinned = pinned;
    const row = card.row;
    this.details.textContent = row.offline ? rosterSeen(row.point.time) : rosterHealth(row.state);
    this.details.hidden = false;
    card.button.setAttribute("aria-describedby", this.details.id);
    this.positionDetails();
  }

  update(rows: readonly RosterPlayer[]): void {
    const keep = new Set(rows.map((row) => row.point.player));
    for (const [id, card] of this.cards)
      if (!keep.has(id)) {
        if (this.shown === card) this.hideDetails();
        card.button.remove();
        this.cards.delete(id);
      }
    for (const row of rows) {
      const id = row.point.player;
      let card = this.cards.get(id);
      if (!card) {
        const button = document.createElement("button");
        button.value = String(id);
        const created: RosterCard = { button, row, signature: "" };
        button.onmouseenter = () => {
          if (this.expanded && this.canHover()) this.showDetails(created);
        };
        button.onmouseleave = () => {
          if (this.canHover()) this.hideDetails();
        };
        button.onfocus = () => {
          if (this.expanded && this.canHover() && button.matches?.(":focus-visible"))
            this.showDetails(created);
        };
        button.onblur = () => {
          if (this.canHover()) this.hideDetails();
        };
        button.onclick = () => {
          if (!this.expanded) {
            this.setExpanded(true);
            return;
          }
          this.select(created.row);
          if (!this.canHover() && this.touchInput) this.showDetails(created, true);
        };
        this.root.append(button);
        card = created;
        this.cards.set(id, card);
      }
      card.row = row;
      card.button.dataset.dimension = row.dimension;
      card.button.dataset.offline = String(row.offline);
      card.button.setAttribute(
        "aria-label",
        `${row.offline ? "View last location of" : "Follow"} ${row.name}, ${dimensionName(row.dimension)}, ${row.offline ? "Offline" : rosterHealth(row.state)}`,
      );
      const signature = JSON.stringify([row.name, row.uuid]);
      if (signature !== card.signature) {
        card.signature = signature;
        const name = document.createElement("span");
        name.className = "history-roster-name";
        name.textContent = row.name;
        card.button.replaceChildren(createRosterHead(row.uuid), name);
      }
      if (this.shown === card) this.showDetails(card, this.pinned);
    }
  }

  dispose(): void {
    this.listeners.abort();
    this.hideDetails();
    this.details.remove();
    this.cards.clear();
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
