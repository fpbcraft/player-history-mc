import type {
  BlueMapApp,
  BlueMapRuntime,
  HtmlMarker,
  MarkerSet,
  Mesh,
  Raycaster,
} from "./bluemap-types.js";
import {
  createEventIcon,
  eventColor,
  FALLBACK_HEAD,
  formatCoordinates,
  formatShortTimestamp,
  formatTimestamp,
  playerColor,
} from "./event-presentation.js";
import { createVitals, meterLevels, renderVitals } from "./player-vitals.js";
import { HistoryScene3D } from "./history-scene3d.js";
import { eventDetails, trailPoint } from "./telemetry.js";
import type {
  HistoryEvent,
  HistoryPoint,
  HistoryRegistry,
  PlayerState,
  PointSegment,
} from "./types.js";

const closestElement = (
  target: EventTarget | null | undefined,
  selector: string,
): HTMLElement | null => {
  if (!target || typeof (target as Element).closest !== "function") return null;
  return (target as Element).closest<HTMLElement>(selector);
};

export { eventColor, meterLevels, playerColor };

export interface TooltipPointer {
  target: EventTarget | null;
  clientX: number;
  clientY: number;
  buttons?: number;
  pointerType?: string;
}

export class BlueMapAdapter {
  readonly app: BlueMapApp;
  readonly api: BlueMapRuntime;
  readonly root: MarkerSet;
  readonly players: MarkerSet;
  readonly trails: MarkerSet;
  readonly events: MarkerSet;
  readonly hoverDot: HtmlMarker;
  readonly tooltip: HTMLDivElement;
  readonly hoverListeners: AbortController;
  readonly raycaster: Raycaster;
  readonly scene3d: HistoryScene3D;
  readonly eventMarkers = new Map<string, HtmlMarker>();
  nextEventId = 0;
  hoverActive = false;
  hoverFrame: number | undefined;
  hoverEvent?: PointerEvent;
  hoverState: [number, number] | null = null;
  hoverToken: object = {};
  expandedGroup: HtmlMarker | null = null;
  heat: Mesh | null = null;
  stateDetails?: (player: number, time: number) => Promise<string>;

  constructor(app: BlueMapApp, api: BlueMapRuntime) {
    this.app = app;
    this.api = api;
    if (!api?.MarkerSet || !api?.HtmlMarker || !api?.Three || !app?.mapViewer?.markers)
      throw Error("Unsupported BlueMap web API");
    this.root = new api.MarkerSet("player-history-replay", {
      label: "Historical replay",
      toggleable: false,
    });
    this.players = new api.MarkerSet("history-players", { toggleable: false });
    this.trails = new api.MarkerSet("history-trails", { toggleable: false });
    this.events = new api.MarkerSet("history-events", { toggleable: false });
    this.hoverDot = new api.HtmlMarker("history-hover-point");
    this.hoverDot.anchor.set(7, 7);
    this.hoverDot.element.className = "history-trail-dot";
    this.hoverDot.element.hidden = true;
    this.scene3d = new HistoryScene3D(
      api,
      new URL("player-history/skins/", document.baseURI).href,
    );
    this.root.add(this.players, this.trails, this.events, this.hoverDot, this.scene3d.root);
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
    if (this.raycaster.params.Line) this.raycaster.params.Line.threshold = 0.2;
    document.addEventListener(
      "click",
      (event) => {
        if (!closestElement(event.target, "bluemap-player-replay, button, input, select"))
          this.hover(event);
      },
      { signal: this.hoverListeners.signal },
    );
    document.addEventListener(
      "pointermove",
      (event) => {
        this.hoverEvent = event;
        this.hoverActive = true;
        if (!this.hoverFrame)
          this.hoverFrame = requestAnimationFrame(() => {
            this.hoverFrame = undefined;
            this.hover(this.hoverEvent);
          });
      },
      { signal: this.hoverListeners.signal },
    );
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (this.expandedGroup && !closestElement(event.target, ".history-event-group"))
          this.collapseEventGroup();
        this.tooltip.hidden = true;
        this.hoverDot.element.hidden = true;
      },
      { signal: this.hoverListeners.signal },
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          this.tooltip.hidden = true;
          this.hoverDot.element.hidden = true;
        }
      },
      { signal: this.hoverListeners.signal },
    );
    window.addEventListener(
      "blur",
      () => {
        this.tooltip.hidden = true;
        this.hoverDot.element.hidden = true;
      },
      { signal: this.hoverListeners.signal },
    );
    document.addEventListener(
      "pointerleave",
      () => {
        this.hoverActive = false;
        this.tooltip.hidden = true;
        this.hoverDot.element.hidden = true;
      },
      { signal: this.hoverListeners.signal },
    );
  }
  hover(event?: TooltipPointer): void {
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
      ".history-event-list-item, .history-event, .history-player",
    );
    let text = annotation?.dataset.historyTooltip;
    if (annotation?.dataset.player)
      this.hoverState = [Number(annotation.dataset.player), Number(annotation.dataset.time)];
    if (!text && !closestElement(event.target, "bluemap-player-replay, button, input, select")) {
      const viewer = this.app.mapViewer,
        bounds = viewer.renderer.domElement.getBoundingClientRect();
      const position = new this.api.Three.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(position, viewer.camera);
      const hit = this.raycaster.intersectObjects(this.scene3d.raycastObjects(), true)[0];
      if (hit) {
        const data = hit.object.userData;
        if (data.historyKind === "trail") {
          const points = Array.isArray(data.historyPoints)
            ? (data.historyPoints as HistoryPoint[])
            : [];
          const point = trailPoint(
            points,
            hit.index ?? hit.faceIndex ?? -1,
            hit.pointOnLine ?? hit.point,
          );
          if (point) {
            this.hoverDot.position.set(point.x / 32, point.y / 32, point.z / 32);
            this.hoverDot.element.style.background = playerColor(point.player);
            this.hoverDot.element.hidden = false;
            text = `${String(data.historyName ?? point.player)} · Trail\n${formatTimestamp(point.time)}\nPosition: ${formatCoordinates(point)}`;
            this.hoverState = [point.player, point.time];
          }
        } else if (data.historyKind === "player") {
          text = typeof data.historyTooltip === "string" ? data.historyTooltip : undefined;
          const player = Number(data.historyPlayer);
          const time = Number(data.historyTime);
          if (Number.isFinite(player) && Number.isFinite(time)) this.hoverState = [player, time];
        } else if (data.historyKind === "events") {
          const tooltips = Array.isArray(data.historyEventTooltips)
            ? (data.historyEventTooltips as string[])
            : [];
          const points = Array.isArray(data.historyEventPoints)
            ? (data.historyEventPoints as HistoryPoint[])
            : [];
          const index = hit.instanceId ?? -1;
          text = tooltips[index];
          const point = points[index];
          if (point) this.hoverState = [point.player, point.time];
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
      this.tooltip.style.top =
        Math.max(8, Math.min(event.clientY + 14, innerHeight - this.tooltip.offsetHeight - 8)) +
        "px";
    }
  }
  focusTooltip(element: HTMLElement): void {
    element.onfocus = () => {
      const bounds = element.getBoundingClientRect();
      this.hover({
        target: element,
        clientX: bounds.right,
        clientY: bounds.top,
      });
    };
    element.onblur = () => {
      this.tooltip.hidden = true;
      this.hoverDot.element.hidden = true;
    };
  }
  collapseEventGroup(): void {
    for (const marker of this.eventMarkers.values()) {
      marker.element.hidden = false;
      const list = marker.element.querySelector<HTMLElement>(".history-event-list");
      if (list) list.hidden = true;
      marker.element.classList?.remove("expanded");
      marker.element.setAttribute?.("aria-expanded", "false");
    }
    this.expandedGroup = null;
  }
  expandEventGroup(marker: HtmlMarker): void {
    const list = marker.element.querySelector<HTMLElement>(".history-event-list");
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
  get mapId(): string | undefined {
    return this.app.mapViewer.map?.data?.id ?? this.app.mapViewer.map?.id;
  }
  focusPoint(point: HistoryPoint): boolean {
    const controls = this.app.mapViewer.controlsManager;
    if (!controls?.position?.set || !point) return false;
    controls.position.set(point.x / 32, point.y / 32, point.z / 32);
    controls.updateCamera?.();
    return true;
  }
  setPlayers(
    positions: HistoryPoint[],
    names: Map<number, string>,
    players: HistoryRegistry["players"] = [],
  ): void {
    this.scene3d.setPlayers(positions, names, players);
    // Legacy HTML heads are intentionally cleared: the player itself now exists in the
    // world-space Three.js scene. Tooltips/vitals still work through 3D raycasting.
    this.clear(this.players);
  }
  setPlayerVitals(player: number, state: PlayerState = {}): void {
    this.scene3d.setPlayerVitals(player, state);
  }
  setPlayerHealth(player: number, health: number, maxHealth: number): void {
    this.setPlayerVitals(player, { health, maxHealth });
  }
  clear(set: MarkerSet): void {
    for (const child of [...set.children]) {
      set.remove(child);
    }
  }
  setTrails(segments: PointSegment[], names: Map<number, string> = new Map()): void {
    this.clear(this.trails);
    this.scene3d.setTrails(segments, names);
  }
  setEvents(
    events: HistoryEvent[],
    names: Map<number, string>,
    _seek?: (time: number) => void,
    registry: Partial<HistoryRegistry> = {},
  ): void {
    const spatial = events.filter((event) => event.type !== "CHAT");
    this.scene3d.setEvents(spatial, names, registry);

    // Text is still text: chat remains an HTML bubble while every non-text event gets
    // a depth-tested 3D anchor.
    const chats = events.filter((event) => event.type === "CHAT");
    const keep = new Set<string>();
    for (const event of chats) {
      const key = JSON.stringify([event.point, event.type, event.payload]);
      keep.add(key);
      let marker = this.eventMarkers.get(key);
      if (!marker) {
        marker = new this.api.HtmlMarker(`chat${this.nextEventId++}`);
        this.eventMarkers.set(key, marker);
        marker.anchor.set(8, 18);
        marker.element.className = "history-chat-bubble";
        marker.element.tabIndex = 0;
        this.focusTooltip(marker.element);
        this.events.add(marker);
      }
      const message = eventDetails(event.payload, registry, "CHAT");
      marker.element.textContent = message;
      marker.element.dataset.historyTooltip =
        `${names.get(event.point.player) || event.point.player} · chat\n${formatTimestamp(event.point.time)}\n${message}`;
      marker.element.dataset.player = String(event.point.player);
      marker.element.dataset.time = String(event.point.time);
      marker.element.setAttribute("aria-label", marker.element.dataset.historyTooltip);
      marker.position.set(
        event.point.x / 32,
        event.point.y / 32 + 2.15,
        event.point.z / 32,
      );
    }

    for (const [key, marker] of this.eventMarkers) {
      if (keep.has(key)) continue;
      this.events.remove(marker);
      this.eventMarkers.delete(key);
    }
    this.expandedGroup = null;
  }
  layoutEvents(): void {
    for (const marker of this.eventMarkers.values()) {
      marker.offsetX = 0;
      marker.offsetY = 0;
      marker.element.style.translate = "0 0";
      marker.element.style.setProperty?.("--connector-length", "0px");
    }
  }
  setHeatmap(
    rows: [number, number, number, number, number][],
    size: number,
    opacity: number,
  ): void {
    this.clearHeatmap();
    if (!rows.length) return;
    const T = this.api.Three,
      positions = [],
      colors = [],
      max = rows.reduce((max, r) => Math.max(max, r[4]), 0);
    // One geometry and material for every cell, projected onto the viewer's current map height.
    const height = this.app.mapViewer.controlsManager?.position?.y ?? 64;
    for (const row of rows) {
      const x = row[2] * size,
        z = row[3] * size,
        value = Math.log1p(row[4]) / Math.log1p(max),
        c = new T.Color().setHSL((1 - value) * 0.65, 1, 0.5);
      for (const [dx, dz] of [
        [0, 0],
        [1, 1],
        [1, 0],
        [0, 0],
        [0, 1],
        [1, 1],
      ] as const) {
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
      side: T.DoubleSide,
    });
    this.heat = new T.Mesh(geometry, material);
    this.heat.renderOrder = 100;
    this.root.add(this.heat);
  }
  clearHeatmap(): void {
    if (this.heat) {
      this.root.remove(this.heat);
      this.heat.geometry.dispose();
      this.heat.material.dispose();
      this.heat = null;
    }
  }
  dispose(): void {
    this.hoverListeners.abort();
    if (this.hoverFrame !== undefined) cancelAnimationFrame(this.hoverFrame);
    this.tooltip.remove();
    this.clearHeatmap();
    this.scene3d.dispose();
    this.clear(this.players);
    this.clear(this.trails);
    this.clear(this.events);
    this.app.popupMarkerSet.remove(this.root);
  }
}
