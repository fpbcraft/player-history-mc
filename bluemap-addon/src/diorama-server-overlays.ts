import type { DioramaApi, OverlayRegistration } from "./diorama-api.js";
import { aggregateCorners } from "./diorama-geometry.js";
import { formatMinecraftTime, minecraftDay } from "./world-status.js";

interface Cell {
  x: number;
  z: number;
  color?: number;
  total?: number;
  forceLoadMarked?: boolean;
}
interface DimensionData {
  loaded?: Cell[];
  pinned?: Cell[];
  claims?: Cell[];
  entities?: Cell[];
}
interface Snapshot {
  version: number;
  generatedAt: number;
  dimensions?: Record<string, DimensionData>;
}
type Key = "loaded" | "claims" | "entities";
const finiteCell = (value: Cell): boolean => Number.isFinite(value?.x) && Number.isFinite(value?.z);

/** Uses the existing public snapshots. X/Z-only aggregates are explicitly approximate. */
export class DioramaServerOverlays {
  private readonly controls = document.createElement("details");
  private readonly status = document.createElement("small");
  private readonly clock = document.createElement("div");
  private readonly enabled = new Set<Key>();
  private readonly overlay: OverlayRegistration;
  private readonly listeners = new AbortController();
  private snapshot: Snapshot | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private request: AbortController | undefined;
  private lastTime:
    | { generatedAt: number; dimensions?: Record<string, { dayTime: number; season?: string }> }
    | undefined;

  constructor(
    private readonly api: DioramaApi,
    private readonly base: URL,
    private readonly height = 64,
  ) {
    this.controls.className = "diorama-overlay-controls";
    const summary = document.createElement("summary");
    summary.setAttribute("aria-label", "Overlays");
    summary.title = "Overlays";
    summary.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m3 7 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 17l9 5 9-5"/></svg>';
    const body = document.createElement("div");
    body.className = "map-menu-body panel";
    const title = document.createElement("strong");
    title.textContent = "Overlays";
    body.append(title);
    this.controls.append(summary, body);
    this.clock.className = "diorama-world-clock";
    this.clock.setAttribute("aria-label", "In-game date and time");
    const note = document.createElement("small");
    note.textContent = `Chunk overlays and heatmaps use an approximate Y=${height} reference plane. Surface height and underground occlusion are unavailable.`;
    body.append(note);
    for (const [key, label] of [
      ["loaded", "Loaded / forced chunks"],
      ["claims", "OPAC ownership"],
      ["entities", "Entity density"],
    ] as const) {
      const row = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.onchange = () => {
        input.checked ? this.enabled.add(key) : this.enabled.delete(key);
        this.overlay.invalidate();
        void this.poll();
      };
      row.append(input, document.createTextNode(` ${label}`));
      body.append(row);
    }
    const heat = document.createElement("button");
    heat.type = "button";
    heat.textContent = "Toggle activity heatmap";
    let heatEnabled = false;
    document.addEventListener(
      "player-history:heatmap-state",
      (event) => {
        heatEnabled = Boolean((event as CustomEvent<{ enabled: boolean }>).detail.enabled);
        heat.setAttribute("aria-pressed", String(heatEnabled));
      },
      { signal: this.listeners.signal },
    );
    heat.onclick = () =>
      document.dispatchEvent(
        new CustomEvent("player-history:heatmap-toggle", { detail: { enabled: !heatEnabled } }),
      );
    body.append(heat, this.status);
    const tools = document.getElementById("map-tools") ?? document.body;
    tools.prepend(this.clock, this.controls);
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!this.controls.contains(event.target as Node)) this.controls.open = false;
      },
      { signal: this.listeners.signal },
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && this.controls.open) {
          this.controls.open = false;
          summary.focus();
        }
      },
      { signal: this.listeners.signal },
    );
    this.overlay = api.registerOverlay("server-overlays", {
      draw: (context) => this.draw(context),
    });
    api.events.addEventListener(
      "change",
      () => {
        this.updateClock();
        this.overlay.invalidate();
      },
      { signal: this.listeners.signal },
    );
    void this.poll();
  }

  private updateClock(): void {
    const state = this.api.getState();
    const sample = state ? this.lastTime?.dimensions?.[state.dimension] : undefined;
    const fresh =
      sample &&
      Date.now() - (this.lastTime?.generatedAt ?? 0) <= 10000 &&
      Number.isFinite(sample.dayTime);
    this.clock.dataset.stale = String(!fresh);
    this.clock.replaceChildren();
    if (!fresh) {
      this.clock.textContent = "World time unavailable";
      return;
    }
    const season = sample.season?.replace(/_/g, " ").toLowerCase();
    if (season && ["spring", "summer", "autumn", "fall", "winter"].includes(season)) {
      const symbol = document.createElement("span");
      symbol.className = "season-symbol";
      symbol.setAttribute("aria-hidden", "true");
      symbol.textContent =
        season === "winter" ? "❄" : season === "summer" ? "☀" : season === "spring" ? "❀" : "❧";
      this.clock.append(symbol, `${season[0]?.toUpperCase()}${season.slice(1)} · `);
    }
    this.clock.append(
      `Day ${minecraftDay(sample.dayTime)} · ${formatMinecraftTime(sample.dayTime)}`,
    );
    this.clock.title = `In-game date and time · ${state?.dimension}`;
  }

  private async poll(): Promise<void> {
    if (this.request || this.listeners.signal.aborted) return;
    clearTimeout(this.timer);
    const controller = new AbortController();
    this.request = controller;
    const signal = AbortSignal.any([
      controller.signal,
      this.listeners.signal,
      AbortSignal.timeout(8000),
    ]);
    try {
      if (document.hidden) return;
      const status = await fetch(new URL("world-status.json", this.base), {
        cache: "no-store",
        signal,
      });
      this.lastTime = status.ok ? await status.json() : undefined;
      this.updateClock();
      if (!this.enabled.size) return;
      const response = await fetch(new URL("server-overlays.json", this.base), {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw Error("Public server overlays unavailable");
      const snapshot = (await response.json()) as Snapshot;
      if (![1, 2].includes(snapshot.version) || !Number.isFinite(snapshot.generatedAt))
        throw Error("Unsupported overlay snapshot");
      this.snapshot = snapshot;
      this.status.textContent =
        Date.now() - snapshot.generatedAt > 10000 ? "Server overlay snapshot is stale" : "";
    } catch (error) {
      if (!signal.aborted)
        this.status.textContent =
          error instanceof Error ? error.message : "Server overlays unavailable";
      this.snapshot = undefined;
    } finally {
      this.request = undefined;
      this.overlay.invalidate();
      if (!this.listeners.signal.aborted) this.timer = setTimeout(() => void this.poll(), 5000);
    }
  }

  private cell(
    context: CanvasRenderingContext2D,
    cell: Cell,
    color: string,
    outline = false,
  ): void {
    if (!finiteCell(cell)) return;
    const corners = aggregateCorners(this.api, cell.x * 16, cell.z * 16, 16, this.height);
    context.beginPath();
    corners.forEach((point, index) => {
      if (point) index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y);
    });
    context.closePath();
    context.fillStyle = color;
    context.strokeStyle = color;
    outline ? context.stroke() : context.fill();
  }

  private draw(context: CanvasRenderingContext2D): void {
    const state = this.api.getState();
    if (!state || !this.snapshot || Date.now() - this.snapshot.generatedAt > 10000) return;
    const data = this.snapshot.dimensions?.[state.dimension];
    if (!data) return;
    context.lineWidth = 2;
    for (const key of this.enabled) {
      const cells = data[key];
      if (!Array.isArray(cells)) continue;
      for (const cell of cells.slice(0, 20000)) {
        const color =
          key === "claims"
            ? `#${((cell.color ?? 0x58a96a) & 0xffffff).toString(16).padStart(6, "0")}66`
            : key === "loaded"
              ? "#58b4ed44"
              : `hsla(${Math.max(0, 120 - Math.log1p(cell.total ?? 0) * 25)},90%,55%,.45)`;
        this.cell(context, cell, color);
        if (cell.forceLoadMarked) this.cell(context, cell, "#ffd166", true);
      }
    }
    if (this.enabled.has("loaded") && Array.isArray(data.pinned))
      for (const cell of data.pinned.slice(0, 20000)) this.cell(context, cell, "#ffd166", true);
  }

  dispose(): void {
    this.listeners.abort();
    this.request?.abort();
    clearTimeout(this.timer);
    this.overlay.remove();
    this.controls.remove();
    this.clock.remove();
  }
}
