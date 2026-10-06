import type {
  BlueMapApp,
  BlueMapPopupMarker,
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
  readonly bar: HTMLDivElement;
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
  private playerIconMode = false;
  private following: number | null = null;
  private liveMode = false;
  private readonly playerUuids = new Map<number, string>();
  private readonly hiddenNativePlayerElements = new Map<HTMLElement, string>();
  private currentPlayerPositions: readonly HistoryPoint[] = [];
  private playerOcclusionElapsedMs = 0;
  private popupOverride:
    | {
        marker: BlueMapPopupMarker;
        onMapInteraction: ((event: unknown) => void) | undefined;
        display: string | undefined;
        cubeVisible: boolean | undefined;
        visible: boolean | undefined;
      }
    | undefined;
  private static readonly PLAYER_ICON_ENTER_DISTANCE = 220;
  private static readonly PLAYER_ICON_EXIT_DISTANCE = 170;

  constructor(app: BlueMapApp, api: BlueMapRuntime) {
    this.app = app;
    this.api = api;
    if (!api?.MarkerSet || !api?.HtmlMarker || !api?.Three || !app?.mapViewer?.markers)
      throw Error("Unsupported BlueMap web API");

    // Disable BlueMap's stock coordinate popup without removing/disposal.
    // PopupMarker installs global close listeners that outlive MarkerSet.remove();
    // disposing it here leaves those listeners dereferencing a removed DOM element.
    const popup = app.popupMarker;
    if (popup) {
      this.popupOverride = {
        marker: popup,
        onMapInteraction: popup.onMapInteraction,
        display: popup.element?.style.display,
        cubeVisible: popup.cube?.visible,
        visible: popup.visible,
      };
      popup.onMapInteraction = () => {};
      if (popup.element) popup.element.style.display = "none";
      if (popup.cube) popup.cube.visible = false;
      popup.visible = false;
    }

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
      new URL("player-history/equipment/", document.baseURI).href,
      (player) => this.followPlayer(player),
    );
    this.root.add(this.players, this.trails, this.events, this.hoverDot, this.scene3d.root);
    app.popupMarkerSet.add(this.root);

    this.bar = document.createElement("div");
    this.bar.className = "history-player-followbar";
    document.body.append(this.bar);

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

    app.events?.addEventListener(
      "bluemapRenderFrame",
      (event) => {
        if (!this.currentPlayerPositions.length) return;
        this.updatePlayerRenderMode();
        this.playerOcclusionElapsedMs +=
          Number((event as CustomEvent<{ delta?: number }>).detail?.delta) || 100;
        if (this.playerIconMode || this.playerOcclusionElapsedMs < 100) return;
        this.playerOcclusionElapsedMs = 0;
        this.syncPlayerMarkerVisibility();
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

      // Trails/events are intentionally overlays again. Preserve the original LineMarker
      // trail hit-testing so hovering still resolves an interpolated timestamp.
      const trailHit = this.raycaster.intersectObjects(
        this.trails.children.flatMap((marker) => (marker.line ? [marker.line] : [])),
        false,
      )[0];
      if (trailHit) {
        const data = trailHit.object.userData;
        const points = Array.isArray(data.historyPoints)
          ? (data.historyPoints as HistoryPoint[])
          : [];
        const point = trailPoint(
          points,
          trailHit.faceIndex ?? -1,
          trailHit.pointOnLine ?? trailHit.point,
        );
        if (point) {
          this.hoverDot.position.set(point.x / 32, point.y / 32, point.z / 32);
          this.hoverDot.element.style.background = playerColor(point.player);
          this.hoverDot.element.hidden = false;
          text = `${String(data.historyName ?? point.player)} · Trail\n${formatTimestamp(point.time)}\nPosition: ${formatCoordinates(point)}`;
          this.hoverState = [point.player, point.time];
        }
      }

      // Players remain real 3D models, so only player avatars are ray-tested here.
      if (!text) {
        const hit = this.raycaster.intersectObjects(this.scene3d.raycastObjects(), true)[0];
        if (hit?.object.userData.historyKind === "player") {
          const data = hit.object.userData;
          text = typeof data.historyTooltip === "string" ? data.historyTooltip : undefined;
          const player = Number(data.historyPlayer);
          const time = Number(data.historyTime);
          if (Number.isFinite(player) && Number.isFinite(time)) this.hoverState = [player, time];
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
  private playerHeadUrl(
    player: number,
    players: HistoryRegistry["players"],
  ): string {
    const uuid = players.find((p) => p.id === player)?.uuid;
    const root = this.app.mapViewer.map?.data?.mapDataRoot;
    return uuid && root ? `${root}/assets/playerheads/${uuid}.png` : FALLBACK_HEAD;
  }

  private syncFollowButtons(): void {
    for (const child of this.bar.children) {
      const button = child as HTMLButtonElement;
      button.ariaPressed = String(Number(button.value) === this.following);
    }
  }

  private restoreNativePlayerMarkers(): void {
    for (const [element, display] of this.hiddenNativePlayerElements) {
      element.style.display = display;
    }
    this.hiddenNativePlayerElements.clear();
  }

  private nativePlayerElement(player: number): HTMLElement | undefined {
    const uuid = this.playerUuids.get(player);
    return uuid ? this.app.playerMarkerManager?.getPlayerMarker?.(uuid)?.element : undefined;
  }

  private syncNativePlayerMarkers(hidden: ReadonlySet<number>): void {
    const active = new Set<HTMLElement>();
    for (const { player } of this.currentPlayerPositions) {
      const element = this.nativePlayerElement(player);
      if (!element) continue;
      active.add(element);
      if (hidden.has(player)) {
        if (!this.hiddenNativePlayerElements.has(element))
          this.hiddenNativePlayerElements.set(element, element.style.display);
        element.style.display = "none";
      } else if (this.hiddenNativePlayerElements.has(element)) {
        element.style.display = this.hiddenNativePlayerElements.get(element) ?? "";
        this.hiddenNativePlayerElements.delete(element);
      }
    }
    for (const [element, display] of [...this.hiddenNativePlayerElements]) {
      if (active.has(element)) continue;
      element.style.display = display;
      this.hiddenNativePlayerElements.delete(element);
    }
  }

  private updatePlayerRenderMode(): void {
    const distance = this.app.mapViewer.controlsManager?.distance ?? 0;
    const next = this.playerIconMode
      ? distance > BlueMapAdapter.PLAYER_ICON_EXIT_DISTANCE
      : distance >= BlueMapAdapter.PLAYER_ICON_ENTER_DISTANCE;
    if (next === this.playerIconMode) return;
    this.playerIconMode = next;
    this.scene3d.setPlayersVisible(!next);
  }

  private canOccludePlayer(object: unknown): boolean {
    let node = object as {
      visible?: boolean;
      userData?: Record<string, unknown>;
      parent?: unknown;
      material?: { depthTest?: boolean; opacity?: number };
    } | null;
    for (; node; node = node.parent as typeof node) {
      if (node.visible === false || node.userData?.playerHistory === true) return false;
    }
    const material = (
      object as { material?: { depthTest?: boolean; opacity?: number } }
    ).material;
    return material?.depthTest !== false && material?.opacity !== 0;
  }

  private playerOccluded(player: number): boolean {
    const target = this.scene3d.playerTarget(player);
    const terrain = this.app.mapViewer.map?.hiresTileManager?.scene;
    const camera = this.app.mapViewer.camera as {
      position?: { x?: number; y?: number; z?: number };
      updateMatrixWorld?(): void;
    };
    const c = camera.position;
    const p = target?.position;
    if (
      !target ||
      !terrain ||
      !c ||
      [p?.x, p?.y, p?.z, c.x, c.y, c.z].some((value) => !Number.isFinite(value))
    )
      return false;

    camera.updateMatrixWorld?.();
    terrain.position.x = 0;
    terrain.position.z = 0;
    terrain.updateMatrixWorld?.();
    const roots = [terrain, this.app.mapViewer.markers];

    return [1.65, 1.05].every((height) => {
      const sample = new this.api.Three.Vector3(
        p.x as number,
        (p.y as number) + height,
        p.z as number,
      );
      if (!sample.project) return false;
      sample.project(camera);
      if (
        Math.abs(sample.x) > 1 ||
        Math.abs(sample.y) > 1 ||
        sample.z < -1 ||
        sample.z > 1
      )
        return false;

      const distance = Math.hypot(
        (p.x as number) - (c.x as number),
        (p.y as number) + height - (c.y as number),
        (p.z as number) - (c.z as number),
      );
      this.raycaster.setFromCamera(sample, camera);
      const hit = this.raycaster
        .intersectObjects(roots, true)
        .find(({ object }) => this.canOccludePlayer(object));
      return (
        typeof hit?.distance === "number" &&
        hit.distance < distance - 0.15
      );
    });
  }

  private syncPlayerMarkerVisibility(): void {
    const hiddenNative = new Set<number>();
    for (const { player } of this.currentPlayerPositions) {
      const occluded = !this.playerIconMode && this.playerOccluded(player);
      const useNative =
        occluded && this.liveMode && Boolean(this.nativePlayerElement(player));
      const showHistory = this.playerIconMode || (occluded && !useNative);
      const marker = this.players.markers.get(`p${player}`);
      if (marker) {
        (marker as HtmlMarker & { visible?: boolean }).visible = showHistory;
        marker.element.style.display = showHistory ? "" : "none";
      }
      if (!this.playerIconMode && !useNative) hiddenNative.add(player);
    }
    this.syncNativePlayerMarkers(hiddenNative);
  }

  private followPlayer(player: number): void {
    const c = this.app.mapViewer.controlsManager?.controls;
    const uuid = this.playerUuids.get(player);
    const nativeTarget =
      this.liveMode && uuid
        ? this.app.playerMarkerManager?.getPlayerMarker?.(uuid)
        : undefined;
    const target = nativeTarget ?? this.scene3d.playerTarget(player);
    if (!c?.followPlayerMarker || !target) return;
    if (this.following === player && c.data?.followingPlayer != null) {
      c.stopFollowingPlayerMarker?.();
      this.following = null;
    } else {
      c.followPlayerMarker(target);
      this.following = player;
    }
    this.syncFollowButtons();
  }

  private updatePlayerBar(
    positions: readonly HistoryPoint[],
    names: ReadonlyMap<number, string>,
    players: HistoryRegistry["players"],
  ): void {
    const key = `${this.mapId}:${positions.map((p) => p.player).join(",")}`;
    if (this.bar.dataset.players !== key) {
      this.bar.dataset.players = key;
      this.bar.replaceChildren();
      for (const { player } of positions) {
        const button = document.createElement("button");
        button.value = String(player);
        button.title = names.get(player) ?? button.value;
        button.onclick = () => this.followPlayer(player);
        const image = document.createElement("img");
        image.src = this.playerHeadUrl(player, players);
        image.onerror = () => (image.src = FALLBACK_HEAD);
        button.append(image);
        this.bar.append(button);
      }
    }
    this.syncFollowButtons();
  }

  setPlayers(
    positions: HistoryPoint[],
    names: Map<number, string>,
    players: HistoryRegistry["players"] = [],
    liveMode = false,
  ): void {
    this.liveMode = liveMode;
    this.currentPlayerPositions = [...positions];
    this.playerUuids.clear();
    for (const player of players) {
      if (player.uuid) this.playerUuids.set(player.id, player.uuid);
    }
    this.scene3d.setPlayers(positions, names, players);
    const c = this.app.mapViewer.controlsManager?.controls;
    if (
      this.following !== null &&
      (!c?.data?.followingPlayer || !positions.some((p) => p.player === this.following))
    ) {
      c?.stopFollowingPlayerMarker?.();
      this.following = null;
    }
    this.updatePlayerBar(positions, names, players);

    this.updatePlayerRenderMode();

    const keep = new Set<string>();
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
        head.src = this.playerHeadUrl(p.player, players);
        head.onerror = () => {
          head.onerror = null;
          head.src = FALLBACK_HEAD;
        };

        marker.element.append(createVitals(), head);
        marker.element.dataset.historyHead = head.src;
        marker.element.tabIndex = 0;
        marker.element.setAttribute("role", "button");
        marker.element.onclick = (event) => {
          event?.stopPropagation?.();
          this.followPlayer(p.player);
        };
        marker.element.onkeydown = (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            marker?.element.click();
          }
        };
        this.focusTooltip(marker.element);
        this.players.add(marker);
      }

      marker.element.dataset.historyTooltip =
        `♟ ${names.get(p.player) || p.player}\n◷ ${formatTimestamp(p.time)}\n⌖ ${formatCoordinates(p)}`;
      marker.element.dataset.player = String(p.player);
      marker.element.dataset.time = String(p.time);
      marker.element.setAttribute(
        "aria-label",
        marker.element.dataset.historyTooltip,
      );
      marker.element.style.borderColor = playerColor(p.player);
      marker.position.set(p.x / 32, p.y / 32, p.z / 32);
    }

    for (const [id, marker] of this.players.markers) {
      if (!keep.has(id)) this.players.remove(marker);
    }

    this.syncPlayerMarkerVisibility();
  }
  setPlayerVitals(
    player: number,
    state: PlayerState = {},
    items: readonly HistoryRegistry["items"][number][] = [],
  ): void {
    this.scene3d.setPlayerVitals(player, state, items);
    const element = this.players.markers.get(`p${player}`)?.element;
    renderVitals(element?.querySelector(".history-player-vitals"), state);
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
    // Keep the current tooltip stable while playback replaces line geometry.
    // The next real pointer movement performs a fresh hit test.
  }
  setEvents(
    events: HistoryEvent[],
    names: Map<number, string>,
    _seek?: (time: number) => void,
    registry: Partial<HistoryRegistry> = {},
  ): void {
    const grouped = new Map<string, HistoryEvent[]>();
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
    const keep = new Set<string>();
    for (const bucket of grouped.values()) {
      bucket.sort((a, b) => a.point.time - b.point.time);
      const e = bucket.at(-1);
      if (!e) continue;
      const key =
        bucket.length === 1
          ? JSON.stringify([e.point, e.type, e.payload])
          : JSON.stringify([
              "group",
              ...bucket.map((item) => [item.point.time, item.type, item.payload]),
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
        if (bucket.length > 1) {
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
              `${names.get(item.point.player) || item.point.player} · ${item.type.toLowerCase().replaceAll("_", " ")} · ${formatShortTimestamp(item.point.time)}`,
            );
            const copy = document.createElement("span");
            const title = document.createElement("strong");
            title.textContent =
              formatShortTimestamp(item.point.time) +
              " · " +
              item.type.toLowerCase().replaceAll("_", " ");
            const description = document.createElement("small");
            description.textContent = details || `Position: ${formatCoordinates(item.point)}`;
            copy.append(title, description);
            detail.append(createEventIcon(item.type), copy);
            detail.onclick = (event) => event.stopPropagation();
            list.append(detail);
          }
          m.element.append(svg, count, list);
        } else m.element.append(svg);
        if (bucket.length === 1) this.focusTooltip(m.element);
        this.events.add(m);
      }
      const payload = eventDetails(e.payload, registry, e.type);
      if (bucket.length === 1) {
        const label = e.type.toLowerCase().replaceAll("_", " ");
        const showPosition = [
          "BLOCK_BREAK",
          "BLOCK_PLACE",
          "CONTAINER_OPEN",
          "ITEM_PICKUP",
          "ITEM_DROP",
        ].includes(e.type);
        m.element.dataset.historyTooltip = `${names.get(e.point.player) || e.point.player} · ${label}\n${formatTimestamp(e.point.time)}${showPosition ? `\nPosition: ${formatCoordinates(e.point)}` : ""}${payload ? `\n${payload}` : ""}`;
        const player = registry.players?.find((player) => player.id === e.point.player);
        const root = this.app.mapViewer.map?.data?.mapDataRoot;
        m.element.dataset.historyHead =
          player?.uuid && root ? `${root}/assets/playerheads/${player.uuid}.png` : FALLBACK_HEAD;
      } else {
        delete m.element.dataset.historyTooltip;
        delete m.element.dataset.historyHead;
      }
      m.element.onclick = (event) => {
        event?.stopPropagation?.();
        if (m.element.querySelector?.(".history-event-list")) this.expandEventGroup(m);
        else m.element.focus?.();
      };
      m.element.tabIndex = 0;
      m.element.setAttribute("role", "button");
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
    this.bar.remove();
    this.app.mapViewer.controlsManager?.controls?.stopFollowingPlayerMarker?.();
    this.following = null;
    this.restoreNativePlayerMarkers();
    if (this.popupOverride) {
      const { marker, onMapInteraction, display, cubeVisible, visible } = this.popupOverride;
      if (onMapInteraction) marker.onMapInteraction = onMapInteraction;
      else delete marker.onMapInteraction;
      if (marker.element) marker.element.style.display = display ?? "";
      if (marker.cube && cubeVisible !== undefined) marker.cube.visible = cubeVisible;
      if (visible !== undefined) marker.visible = visible;
      else delete marker.visible;
      this.popupOverride = undefined;
    }
    this.clearHeatmap();
    this.scene3d.dispose();
    this.clear(this.players);
    this.clear(this.trails);
    this.clear(this.events);
    this.app.popupMarkerSet.remove(this.root);
  }
}
