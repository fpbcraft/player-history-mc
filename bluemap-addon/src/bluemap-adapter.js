import { trailPoint, eventDetails } from "./telemetry.js";
/** All BlueMap runtime dependencies live here. Tested against the 5.x webapp API. */
export const playerColor = (id) =>
  `hsl(${(Number(id) * 137.508 + 195) % 360}, 78%, 65%)`;
const eventTypes = [
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
  "ITEM_DROP",
];
export const eventColor = (type) => {
  const index = eventTypes.indexOf(type);
  const hue =
    index >= 0
      ? (index * 137.508) % 360
      : [...type].reduce(
          (hash, char) => (hash * 31 + char.charCodeAt(0)) % 360,
          0,
        );
  return `hsl(${hue}, 82%, 66%)`;
};
export const meterLevels = (value, maximum, limit = 20) => {
  if (!Number.isFinite(value) || !Number.isFinite(maximum) || maximum <= 0)
    return [];
  const slots = Math.max(1, Math.min(limit, Math.ceil(maximum / 2)));
  return Array.from({ length: slots }, (_, index) => {
    const remaining = Math.max(0, Math.min(2, value - index * 2));
    return remaining >= 2 ? "full" : remaining > 0 ? "half" : "empty";
  });
};
const fallbackHead =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><path fill="#b68763" d="M0 0h8v8H0z"/><path fill="#493222" d="M0 0h8v2H0zM0 2h1v1H0zM7 2h1v1H7z"/><path fill="#fff" d="M1 4h2v1H1zM5 4h2v1H5z"/><path fill="#524b88" d="M2 4h1v1H2zM5 4h1v1H5z"/><path fill="#68452f" d="M2 6h4v2H2z"/><path fill="#b68763" d="M3 6h2v1H3z"/></svg>',
  );
const stamp = (time) => new Date(time).toLocaleString();
const shortStamp = (time) => new Date(time).toLocaleTimeString(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const eventPaths = {
  CRAFT: "M3 3h18v18H3zM9 3v18m6-18v18M3 9h18M3 15h18",
  SMELT: "M13 2c2 7 7 8 7 13a8 8 0 01-16 0c0-3 2-5 5-7-1 5 3 6 4 1z",
  ENCHANT: "m4 20 12-12m-9 9-3-3M17 2v4m-2-2h4M5 3v4M3 5h4m12 10v6m-3-3h6",
  TRADE: "M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4",
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
  QUIT: "M10 3H3v18h7m0-9h11m-4-4 4 4-4 4",
};
const eventIcon = (type) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", eventPaths[type] ?? "M5 5h14v14H5zM8 12h8m-4-4v8");
  svg.append(path);
  return svg;
};
const coords = (point) =>
  [point.x, point.y, point.z]
    .map((value) => (value / 32).toFixed(1))
    .join(", ");
export class BlueMapAdapter {
  constructor(app, api) {
    this.app = app;
    this.api = api;
    if (
      !api?.MarkerSet ||
      !api?.HtmlMarker ||
      !api?.Three ||
      !app?.mapViewer?.markers
    )
      throw Error("Unsupported BlueMap web API");
    this.root = new api.MarkerSet("player-history-replay", {
      label: "Historical replay",
      toggleable: false,
    });
    this.players = new api.MarkerSet("history-players", { toggleable: false });
    this.trails = new api.MarkerSet("history-trails", { toggleable: false });
    this.eventMarkers = new Map();
    this.nextEventId = 0;
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
        if (
          !event.target.closest?.(
            "bluemap-player-replay, button, input, select",
          )
        )
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
            this.hoverFrame = null;
            this.hover(this.hoverEvent);
          });
      },
      { signal: this.hoverListeners.signal },
    );
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (this.expandedGroup && !event.target.closest?.(".history-event-group"))
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
  hover(event) {
    if (this.expandedGroup && !event?.target?.closest?.(".history-event-list-item")) {
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
    const annotation = event.target.closest?.(
      ".history-event-list-item, .history-event, .history-player",
    );
    let text = annotation?.dataset.historyTooltip;
    if (annotation?.dataset.player)
      this.hoverState = [
        Number(annotation.dataset.player),
        Number(annotation.dataset.time),
      ];
    if (
      !text &&
      !event.target.closest?.("bluemap-player-replay, button, input, select")
    ) {
      const viewer = this.app.mapViewer,
        bounds = viewer.renderer.domElement.getBoundingClientRect();
      const position = new this.api.Three.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(position, viewer.camera);
      const hit = this.raycaster.intersectObjects(
        this.trails.children.map((marker) => marker.line),
        false,
      )[0];
      if (hit) {
        const data = hit.object.userData;
        const point = trailPoint(
          data.historyPoints,
          hit.faceIndex,
          hit.pointOnLine ?? hit.point,
        );
        if (point) {
          this.hoverDot.position.set(point.x / 32, point.y / 32, point.z / 32);
          this.hoverDot.element.style.background = playerColor(point.player);
          this.hoverDot.element.hidden = false;
          text = `${data.historyName} · Trail\n${stamp(point.time)}\nPosition: ${coords(point)}`;
          this.hoverState = [point.player, point.time];
        }
      }
    }
    this.tooltip.hidden = !text;
    if (text) {
      this.tooltip.textContent = text;
      const token = (this.hoverToken = {});
      if (this.hoverState && this.stateDetails)
        this.stateDetails(...this.hoverState).then((details) => {
          if (this.hoverToken === token && !this.tooltip.hidden)
            this.tooltip.textContent = text + details;
        });
      this.tooltip.style.left =
        Math.max(
          8,
          Math.min(
            event.clientX + 14,
            innerWidth - this.tooltip.offsetWidth - 8,
          ),
        ) + "px";
      this.tooltip.style.top =
        Math.max(
          8,
          Math.min(
            event.clientY + 14,
            innerHeight - this.tooltip.offsetHeight - 8,
          ),
        ) + "px";
    }
  }
  focusTooltip(element) {
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
  collapseEventGroup() {
    for (const marker of this.eventMarkers.values()) {
      marker.element.hidden = false;
      const list = marker.element.querySelector?.(".history-event-list");
      if (list) list.hidden = true;
      marker.element.classList?.remove("expanded");
      marker.element.setAttribute?.("aria-expanded", "false");
    }
    this.expandedGroup = null;
  }
  expandEventGroup(marker) {
    const list = marker.element.querySelector?.(".history-event-list");
    if (!list) return;
    if (this.expandedGroup === marker) {
      this.collapseEventGroup();
      return;
    }
    this.collapseEventGroup();
    this.expandedGroup = marker;
    if (this.tooltip) this.tooltip.hidden = true;
    if (this.hoverDot?.element) this.hoverDot.element.hidden = true;
    for (const other of this.eventMarkers.values())
      other.element.hidden = other !== marker;
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
  createVitals() {
    const vitals = document.createElement("div");
    vitals.className = "history-player-vitals";
    vitals.hidden = true;
    const health = document.createElement("div");
    health.className = "history-vital-row history-health-hearts";
    health.setAttribute("aria-label", "Health");
    vitals.append(health);
    return vitals;
  }
  renderVitals(vitals, state = {}) {
    const healthRow = vitals?.querySelector(".history-health-hearts");
    if (!vitals || !healthRow) return;
    healthRow.replaceChildren();
    const health = meterLevels(state.health, state.maxHealth);
    for (const level of health) {
      const icon = document.createElement("i");
      icon.className = "heart " + level;
      healthRow.append(icon);
    }
    healthRow.setAttribute(
      "aria-label",
      health.length ? "Health " + state.health + " of " + state.maxHealth : "Health unknown",
    );
    vitals.hidden = health.length === 0;
  }
  setPlayers(positions, names, players = []) {
    const keep = new Set();
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
        head.src =
          uuid && root
            ? `${root}/assets/playerheads/${uuid}.png`
            : fallbackHead;
        head.onerror = () => {
          head.onerror = null;
          head.src = fallbackHead;
        };
        marker.element.append(this.createVitals(), head);
        marker.element.tabIndex = 0;
        this.focusTooltip(marker.element);
        this.players.add(marker);
      }
      marker.element.dataset.historyTooltip = `♟ ${names.get(p.player) || p.player}\n◷ ${stamp(p.time)}\n⌖ ${coords(p)}`;
      marker.element.dataset.player = p.player;
      marker.element.dataset.time = p.time;
      marker.element.setAttribute(
        "aria-label",
        marker.element.dataset.historyTooltip,
      );
      marker.element.style.borderColor = playerColor(p.player);
      marker.position.set(p.x / 32, p.y / 32, p.z / 32);
    }
    for (const [id, m] of this.players.markers)
      if (!keep.has(id)) {
        this.players.remove(m);
    }
  }
  setPlayerVitals(player, state = {}) {
    const element = this.players.markers.get("p" + player)?.element;
    this.renderVitals(element?.querySelector(".history-player-vitals"), state);
  }
  setPlayerHealth(player, health, maxHealth) {
    this.setPlayerVitals(player, { health, maxHealth });
  }
  clear(set) {
    for (const child of [...set.children]) {
      set.remove(child);
    }
  }
  setTrails(segments, names = new Map()) {
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
      marker.line.color.setStyle(playerColor(segments[i][0].player));
      const first = segments[i][0];
      marker.line.userData.historyPoints = segments[i];
      marker.line.userData.historyName =
        names.get(first.player) || first.player;
      marker.setLine(
        segments[i].flatMap((p) => [p.x / 32, p.y / 32, p.z / 32]),
      );
      this.trails.add(marker);
    }
    // Keep the current tooltip stable while playback replaces line geometry.
    // The next real pointer movement performs a fresh hit test.
  }
  setEvents(events, names, seek, registry = {}) {
    const grouped = new Map();
    for (const event of events) {
      if (event.type === "CHAT") {
        grouped.set(JSON.stringify([event.point, event.type, event.payload]), [event]);
        continue;
      }
      const p = event.point;
      const key = `group:${p.player}:${p.world}:${Math.round(p.x / 256)}:${Math.round(p.y / 256)}:${Math.round(p.z / 256)}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(event);
    }
    const keep = new Set();
    for (const bucket of grouped.values()) {
      bucket.sort((a, b) => a.point.time - b.point.time);
      const e = bucket.at(-1);
      const key = bucket.length === 1
        ? JSON.stringify([e.point, e.type, e.payload])
        : JSON.stringify(["group", ...bucket.map((item) => [item.point.time, item.type, item.payload])]);
      keep.add(key);
      let m = this.eventMarkers.get(key);
      if (!m) {
        m = new this.api.HtmlMarker(`event${this.nextEventId++}`);
        this.eventMarkers.set(key, m);
        m.anchor.set(16, 16);
        m.element.className = "history-event";
        m.element.style.color = eventColor(e.type);
        m.element.style.borderColor = playerColor(e.point.player);
        const svg = eventIcon(e.type);
        if (e.type === "CHAT") {
          let payload;
          try { payload = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload; } catch { payload = {}; }
          m.element.className += " history-chat-bubble";
          m.element.textContent = `${shortStamp(e.point.time)}  ${String(payload?.message || "")}`;
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
            const details = eventDetails(item.payload, registry);
            detail.dataset.historyTooltip =
              (names.get(item.point.player) || item.point.player) +
              " · " +
              item.type.toLowerCase().replaceAll("_", " ") +
              "\n" +
              stamp(item.point.time) +
              "\nPosition: " +
              coords(item.point) +
              (details ? "\n" + details : "");
            detail.setAttribute("aria-label", detail.dataset.historyTooltip);
            const copy = document.createElement("span");
            const title = document.createElement("strong");
            title.textContent =
              shortStamp(item.point.time) +
              " · " +
              item.type.toLowerCase().replaceAll("_", " ");
            const description = document.createElement("small");
            description.textContent = details || "Position: " + coords(item.point);
            copy.append(title, description);
            detail.append(eventIcon(item.type), copy);
            this.focusTooltip(detail);
            detail.onclick = (event) => {
              event.stopPropagation();
              detail.focus?.();
              detail.onfocus();
            };
            list.append(detail);
          }
          m.element.append(svg, count, list);
        } else m.element.append(svg);
        this.focusTooltip(m.element);
        this.events.add(m);
      }
      const payload = eventDetails(e.payload, registry);
      m.element.dataset.historyTooltip = bucket.length > 1
        ? `${names.get(e.point.player) || e.point.player} · ${bucket.length} events\n${stamp(bucket[0].point.time)} – ${stamp(e.point.time)}\nPosition: ${coords(e.point)}`
        : `${names.get(e.point.player) || e.point.player} · ${e.type.toLowerCase().replaceAll("_", " ")}\n${stamp(e.point.time)}\nPosition: ${coords(e.point)}${payload ? "\n" + payload : ""}`;
      m.element.onclick = (event) => {
        event?.stopPropagation?.();
        if (m.element.querySelector?.(".history-event-list")) {
          this.expandEventGroup(m);
          return;
        }
        m.element.onfocus();
      };
      m.element.tabIndex = 0;
      m.element.setAttribute("role", "button");
      if (bucket.length > 1) m.element.setAttribute("aria-expanded", "false");
      m.element.setAttribute("aria-label", m.element.dataset.historyTooltip);
      m.element.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          m.element.onclick(event);
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
    const occupied = [];
    const reserve = (element, protectHead = false) => {
      const bounds = element?.getBoundingClientRect?.();
      if (!bounds?.width || !bounds?.height) return;
      const extra = protectHead ? 28 : 0;
      occupied.push({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + (bounds.height + extra) / 2,
        width: bounds.width,
        height: bounds.height + extra,
      });
    };
    for (const marker of this.players?.markers?.values?.() || []) {
        reserve(marker.element);
        reserve(
          marker.element.querySelector?.(".history-player-vitals"),
          true,
        );
    }
    for (const marker of this.eventMarkers.values()) {
      const element = marker.element;
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const x = bounds.left + bounds.width / 2 - (marker.offsetX || 0);
      const y = bounds.top + bounds.height / 2 - (marker.offsetY || 0);
      let chosen = null;
      const candidates = [];
      if (String(element.className).includes("history-chat-bubble")) {
        for (let column = -5; column <= 5; column++)
          for (let row = -10; row <= 10; row++) {
            if (!column && !row) continue;
            candidates.push({
              dx: column * (bounds.width + 10),
              dy: row * (bounds.height + 10),
            });
          }
        candidates.sort((a, b) =>
          Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy) ||
          Math.abs(a.dx) - Math.abs(b.dx));
      } else {
        for (let ring = 0; ring < 12; ring++)
          for (let slot = 0; slot < 16; slot++) {
            const angle = -Math.PI / 2 + slot * Math.PI / 8;
            candidates.push({
              dx: Math.cos(angle) * (48 + ring * 34),
              dy: Math.sin(angle) * (48 + ring * 34),
            });
          }
      }
      for (const { dx, dy } of candidates) {
          const cx = x + dx, cy = y + dy;
          if (cx < bounds.width / 2 + 8 || cy < bounds.height / 2 + 8 || cx > innerWidth - bounds.width / 2 - 8 || cy > innerHeight - bounds.height / 2 - 8) continue;
          if (occupied.some(p => Math.abs(p.x - cx) < (p.width + bounds.width) / 2 + 8 && Math.abs(p.y - cy) < (p.height + bounds.height) / 2 + 8)) continue;
          chosen = { dx, dy, x: cx, y: cy };
          break;
      }
      chosen ||= { dx: 0, dy: -48, x, y: y - 48 };
      occupied.push({ ...chosen, width: bounds.width, height: bounds.height });
      marker.offsetX = chosen.dx;
      marker.offsetY = chosen.dy;
      element.style.translate = `${chosen.dx}px ${chosen.dy}px`;
      const distance = Math.hypot(chosen.dx, chosen.dy);
      const ux = distance ? Math.abs(chosen.dx / distance) : 0;
      const uy = distance ? Math.abs(chosen.dy / distance) : 0;
      const edge = Math.min(
        ux ? bounds.width / 2 / ux : Infinity,
        uy ? bounds.height / 2 / uy : Infinity,
      );
      element.style.setProperty("--connector-start", `${Math.min(edge, distance)}px`);
      element.style.setProperty("--connector-length", `${Math.max(0, distance - edge)}px`);
      element.style.setProperty("--connector-angle", `${Math.atan2(-chosen.dy, -chosen.dx)}rad`);
    }
  }
  setHeatmap(rows, size, opacity) {
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
      ]) {
        positions.push(x + dx * size, height, z + dz * size);
        colors.push(c.r, c.g, c.b);
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(positions, 3),
    );
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
    cancelAnimationFrame(this.hoverFrame);
    this.tooltip.remove();
    this.clearHeatmap();
    this.clear(this.players);
    this.clear(this.trails);
    this.clear(this.events);
    this.app.popupMarkerSet.remove(this.root);
  }
}
