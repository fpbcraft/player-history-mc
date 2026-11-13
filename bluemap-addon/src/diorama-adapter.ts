import type { DioramaApi, OverlayRegistration } from "./diorama-api.js";
import { aggregateCorners, historyPosition, hitTrail } from "./diorama-geometry.js";
import {
  createEventIcon,
  eventColor,
  formatCoordinates,
  formatTimestamp,
  playerColor,
} from "./event-presentation.js";
import type { MapAdapter } from "./map-adapter.js";
import {
  PlayerRoster,
  createRosterHead,
  rosterHealth,
  rosterSeen,
  type RosterPlayer,
} from "./player-roster.js";
import { createVitals, renderVitals } from "./player-vitals.js";
import { eventDetails } from "./telemetry.js";
import type {
  HistoryEvent,
  HistoryPoint,
  HistoryRegistry,
  PlayerState,
  PointSegment,
} from "./types.js";

interface Marker {
  dimension: string | undefined;
  element: HTMLButtonElement;
  point: HistoryPoint;
  label: string;
}

export class DioramaAdapter implements MapAdapter {
  stateDetails?: (player: number, time: number) => Promise<string>;
  navigatePlayer?: (point: HistoryPoint) => Promise<void>;
  private readonly layer = document.createElement("div");
  private readonly bar = document.createElement("div");
  private readonly tooltip = document.createElement("div");
  private readonly roster: PlayerRoster;
  private readonly overlay: OverlayRegistration;
  private readonly listeners = new AbortController();
  private readonly markers = new Map<string, Marker>();
  private segments: PointSegment[] = [];
  private heat: { rows: number[][]; size: number; opacity: number } | undefined;
  private following: number | undefined;
  private hoverToken = 0;
  private disposed = false;
  private trailNames = new Map<number, string>();
  private pointerFrame: number | undefined;
  private readonly trailDot = document.createElement("button");
  private hoverMarker: Marker | undefined;

  constructor(
    private readonly api: DioramaApi,
    private readonly base: URL,
    private readonly height = 64,
  ) {
    this.layer.className = "diorama-history-markers";
    this.trailDot.className = "diorama-trail-hit";
    this.trailDot.hidden = true;
    this.trailDot.tabIndex = -1;
    this.layer.append(this.trailDot);
    this.bar.className = "history-player-followbar diorama-player-bar";
    this.tooltip.className = "diorama-history-tooltip";
    this.tooltip.setAttribute("role", "tooltip");
    this.tooltip.hidden = true;
    document.body.append(this.bar, this.tooltip);
    this.roster = new PlayerRoster(
      this.bar,
      (row) => {
        void this.select(row);
      },
      base,
    );
    this.overlay = api.registerOverlay("player-history", {
      element: this.layer,
      draw: (context) => this.draw(context),
      pointer: (event) => {
        this.pointer(event);
        return false;
      },
    });
    api.events.addEventListener(
      "change",
      (event) => {
        if ((event as CustomEvent<{ reason: string }>).detail?.reason === "interaction") {
          this.following = undefined;
          this.hideTooltip();
        }
        this.layoutEvents();
      },
      { signal: this.listeners.signal },
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          this.following = undefined;
          this.hideTooltip();
        }
      },
      { signal: this.listeners.signal },
    );
  }

  get mapId(): string | undefined {
    return this.api.getState()?.dimension;
  }
  focusPoint(point: HistoryPoint): boolean {
    return this.api.navigate(historyPosition(point));
  }

  private async select(row: RosterPlayer): Promise<void> {
    this.following = row.offline ? undefined : row.point.player;
    await this.navigatePlayer?.(row.point);
    if (!this.disposed) this.focusPoint(row.point);
  }

  setRoster(rows: readonly RosterPlayer[]): void {
    this.roster.update(rows);
    const followed = rows.find((row) => row.point.player === this.following && !row.offline);
    if (followed) void this.select(followed);
  }

  private hideTooltip(): void {
    this.hoverToken++;
    this.hoverMarker = undefined;
    this.tooltip.hidden = true;
    this.trailDot.hidden = true;
  }

  private showTooltip(marker: Marker): void {
    this.hoverMarker = marker;
    const token = ++this.hoverToken;
    this.tooltip.textContent = marker.label;
    this.tooltip.hidden = false;
    this.positionTooltip(marker);
    if (!this.stateDetails) return;
    void this.stateDetails(marker.point.player, marker.point.time)
      .then((details) => {
        if (token !== this.hoverToken || this.disposed) return;
        this.tooltip.textContent = marker.label + (details ? `\n${details}` : "");
        this.positionTooltip(marker);
      })
      .catch(() => {});
  }

  private positionTooltip(marker: Marker): void {
    const rect = marker.element.getBoundingClientRect();
    this.tooltip.style.left = `${Math.max(8, Math.min(innerWidth - this.tooltip.offsetWidth - 8, rect.left))}px`;
    this.tooltip.style.top = `${Math.max(8, Math.min(innerHeight - this.tooltip.offsetHeight - 8, rect.bottom + 8))}px`;
  }

  private marker(key: string, point: HistoryPoint, label: string, create: () => Node[]): Marker {
    let marker = this.markers.get(key);
    if (!marker) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "diorama-history-marker";
      element.append(...create());
      marker = { element, point, label, dimension: this.mapId };
      const item = marker;
      element.onpointerenter = (event) => {
        if (event.pointerType !== "touch") this.showTooltip(item);
      };
      element.onpointerleave = () => {
        if (document.activeElement !== element) this.hideTooltip();
      };
      element.onfocus = () => this.showTooltip(item);
      element.onblur = () => this.hideTooltip();
      element.onclick = (event) => {
        event.stopPropagation();
        this.showTooltip(item);
      };
      this.layer.append(element);
      this.markers.set(key, marker);
    }
    marker.dimension = this.mapId;
    marker.point = point;
    marker.label = label;
    marker.element.setAttribute("aria-label", label);
    marker.element.style.borderColor = playerColor(point.player);
    return marker;
  }

  private prune(prefix: string, keep: Set<string>): void {
    for (const [key, marker] of this.markers) {
      if (!key.startsWith(prefix) || keep.has(key)) continue;
      if (this.hoverMarker === marker) this.hideTooltip();
      marker.element.remove();
      this.markers.delete(key);
    }
  }

  setPlayers(
    points: HistoryPoint[],
    names: Map<number, string>,
    players: HistoryRegistry["players"],
  ): void {
    const keep = new Set<string>();
    for (const point of points) {
      const player = players.find((item) => item.id === point.player);
      if (!player) continue;
      const key = `player:${point.player}`;
      keep.add(key);
      this.marker(
        key,
        point,
        `${names.get(point.player) ?? player.name}\n${formatTimestamp(point.time)}\n${formatCoordinates(point)}`,
        () => [createVitals(), createRosterHead(player.uuid, this.base)],
      );
    }
    this.prune("player:", keep);
    this.layoutEvents();
  }

  setOfflineLocations(rows: readonly RosterPlayer[]): void {
    const keep = new Set<string>();
    for (const row of rows) {
      const key = `offline:${row.point.player}`;
      keep.add(key);
      const marker = this.marker(
        key,
        row.point,
        `${row.name} · Offline\n${rosterSeen(row.point.time)}\n${formatCoordinates(row.point)}`,
        () => [createRosterHead(row.uuid, this.base)],
      );
      marker.element.classList.add("diorama-history-offline");
    }
    this.prune("offline:", keep);
    this.layoutEvents();
  }

  setPlayerVitals(player: number, state: PlayerState = {}): void {
    const marker = this.markers.get(`player:${player}`);
    if (marker) {
      marker.label = `${marker.label}\n${rosterHealth(state)}`;
      marker.element.setAttribute("aria-label", marker.label);
    }
    renderVitals(
      this.markers.get(`player:${player}`)?.element.querySelector(".history-player-vitals"),
      state,
    );
  }

  setEvents(
    events: HistoryEvent[],
    names: Map<number, string>,
    _seek?: (time: number) => void,
    registry: Partial<HistoryRegistry> = {},
  ): void {
    const keep = new Set<string>();
    for (const event of events.slice(-500)) {
      const key = `event:${JSON.stringify([event.point, event.type, event.payload])}`;
      keep.add(key);
      const marker = this.marker(
        key,
        event.point,
        `${names.get(event.point.player) ?? "Player"} · ${event.type.toLowerCase().replaceAll("_", " ")}\n${formatTimestamp(event.point.time)}\n${eventDetails(event.payload, registry, event.type)}`,
        () => [createEventIcon(event.type)],
      );
      marker.element.classList.add("diorama-history-event");
      marker.element.style.color = eventColor(event.type);
    }
    this.prune("event:", keep);
    this.layoutEvents();
  }

  layoutEvents(): void {
    const state = this.api.getState();
    if (!state) return;
    for (const marker of this.markers.values()) {
      const pixel = this.api.screen(historyPosition(marker.point));
      if (!pixel) continue;
      marker.element.hidden =
        marker.dimension !== state.dimension ||
        pixel.x < -32 ||
        pixel.y < -32 ||
        pixel.x > state.width + 32 ||
        pixel.y > state.height + 32;
      marker.element.style.transform = `translate(${pixel.x}px,${pixel.y}px) translate(-50%,-50%)`;
    }
    if (this.hoverMarker) this.positionTooltip(this.hoverMarker);
    this.overlay.invalidate();
  }

  setTrails(segments: PointSegment[], names = new Map<number, string>()): void {
    this.trailNames = names;
    this.segments = segments;
    this.overlay.invalidate();
  }
  setHeatmap(
    rows: [number, number, number, number, number][],
    size: number,
    opacity: number,
  ): void {
    this.heat = { rows: rows.slice(0, 20000), size, opacity };
    this.overlay.invalidate();
  }
  clearHeatmap(): void {
    this.heat = undefined;
    this.overlay.invalidate();
  }

  private pointer(event: PointerEvent): void {
    if (this.pointerFrame !== undefined) cancelAnimationFrame(this.pointerFrame);
    if (event.buttons || event.type === "pointerleave") {
      this.hideTooltip();
      return;
    }
    this.pointerFrame = requestAnimationFrame(() => {
      this.pointerFrame = undefined;
      const point = hitTrail(this.api, this.segments, event.clientX, event.clientY);
      if (!point) {
        this.hideTooltip();
        return;
      }
      const pixel = this.api.screen(historyPosition(point));
      if (!pixel) return;
      this.trailDot.hidden = false;
      this.trailDot.style.transform = `translate(${pixel.x}px,${pixel.y}px)`;
      this.showTooltip({
        element: this.trailDot,
        point,
        dimension: this.mapId,
        label: `${this.trailNames.get(point.player) ?? "Player"} · Trail\n${formatTimestamp(point.time)}\n${formatCoordinates(point)}`,
      });
    });
  }

  private draw(context: CanvasRenderingContext2D): void {
    const heat = this.heat;
    if (heat) {
      const max = heat.rows.reduce((max, row) => Math.max(max, row[4] ?? 0), 0);
      context.globalAlpha = heat.opacity;
      for (const row of heat.rows) {
        const corners = aggregateCorners(
          this.api,
          (row[2] ?? 0) * heat.size,
          (row[3] ?? 0) * heat.size,
          heat.size,
          this.api.getState()?.referenceY ?? this.height,
        );
        context.beginPath();
        corners.forEach((corner, i) => {
          if (corner) i ? context.lineTo(corner.x, corner.y) : context.moveTo(corner.x, corner.y);
        });
        context.closePath();
        context.fillStyle = `hsl(${(1 - Math.log1p(row[4] ?? 0) / Math.log1p(max || 1)) * 240},90%,55%)`;
        context.fill();
      }
      context.globalAlpha = 1;
    }
    context.lineWidth = 3;
    for (const segment of this.segments) {
      context.beginPath();
      context.strokeStyle = playerColor(segment[0]?.player ?? 0);
      segment.forEach((point, i) => {
        const pixel = this.api.screen(historyPosition(point));
        if (pixel) i ? context.lineTo(pixel.x, pixel.y) : context.moveTo(pixel.x, pixel.y);
      });
      context.stroke();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.pointerFrame !== undefined) cancelAnimationFrame(this.pointerFrame);
    this.hideTooltip();
    this.listeners.abort();
    this.roster.dispose();
    this.overlay.remove();
    this.bar.remove();
    this.tooltip.remove();
    this.markers.clear();
  }
}
