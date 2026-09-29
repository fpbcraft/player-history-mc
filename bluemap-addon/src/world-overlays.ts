import type { BlueMapApp, BlueMapRuntime, MarkerSet, Mesh } from "./bluemap-types.js";
import { preferences } from "./preferences.js";

type OverlayKey = "heatmap" | "loaded" | "claims" | "forced" | "entities";
type ServerOverlayKey = Exclude<OverlayKey, "heatmap">;

interface ChunkCell { x: number; z: number }
interface EntityCell extends ChunkCell {
  total: number;
  living: number;
  items: number;
  players: number;
}
interface ClaimCell extends ChunkCell {
  dimension: string;
  owner: string;
  color: number;
}
interface DimensionData {
  loaded?: ChunkCell[];
  forced?: ChunkCell[];
  entities?: EntityCell[];
  claims?: ClaimCell[];
}
interface ServerOverlaySnapshot {
  version: number;
  generatedAt: number;
  dimensions?: Record<string, DimensionData>;
}
interface Integration {
  mapWorlds?: Record<string, string>;
}

const SERVER_KEYS: ServerOverlayKey[] = ["loaded", "claims", "forced", "entities"];
const storageKey = (key: ServerOverlayKey) => `fpbcraft-map-overlay-${key}`;

class WorldOverlayController {
  private readonly root: MarkerSet;
  private readonly meshes = new Map<ServerOverlayKey, Mesh>();
  private readonly enabled: Record<OverlayKey, boolean>;
  private readonly inputs = new Map<OverlayKey, HTMLInputElement>();
  private readonly host = document.createElement("div");
  private readonly panel = document.createElement("div");
  private readonly status = document.createElement("small");
  private readonly legend = document.createElement("div");
  private integration?: Integration;
  private timer: number | undefined;
  private loading = false;
  private lastSnapshot?: ServerOverlaySnapshot;

  constructor(
    private readonly app: BlueMapApp,
    private readonly api: BlueMapRuntime,
  ) {
    this.enabled = {
      heatmap: preferences.heatmap(),
      loaded: localStorage.getItem(storageKey("loaded")) === "true",
      claims: localStorage.getItem(storageKey("claims")) === "true",
      forced: localStorage.getItem(storageKey("forced")) === "true",
      entities: localStorage.getItem(storageKey("entities")) === "true",
    };
    this.root = new api.MarkerSet("fpbcraft-world-overlays", {
      label: "World overlays",
      toggleable: false,
    });
    app.popupMarkerSet.add(this.root);
    this.createControls();
    this.updatePolling();

    document.addEventListener("player-history:heatmap-state", (event) => {
      const enabled = Boolean((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled);
      this.enabled.heatmap = enabled;
      const input = this.inputs.get("heatmap");
      if (input) input.checked = enabled;
    });
  }

  private createControls(): void {
    this.host.className = "world-overlays";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "world-overlays__button";
    button.textContent = "Overlays";
    button.setAttribute("aria-expanded", "false");

    this.panel.className = "world-overlays__panel";
    this.panel.hidden = true;
    const heading = document.createElement("strong");
    heading.textContent = "Map overlays";
    this.panel.append(heading);

    const options: [OverlayKey, string, string][] = [
      ["heatmap", "Player activity heatmap", "Time spent by recorded players"],
      ["loaded", "Loaded chunks", "Chunks currently held by the server"],
      ["claims", "OPAC regions", "Open Parties and Claims ownership"],
      ["forced", "Forced chunks", "Chunks explicitly kept loaded"],
      ["entities", "Entity density", "Live entity count by chunk"],
    ];
    for (const [key, label, description] of options) {
      const row = document.createElement("label");
      row.className = "world-overlays__row";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = this.enabled[key];
      input.addEventListener("change", () => this.setEnabled(key, input.checked));
      this.inputs.set(key, input);
      const text = document.createElement("span");
      const title = document.createElement("b");
      title.textContent = label;
      const detail = document.createElement("small");
      detail.textContent = description;
      text.append(title, detail);
      row.append(input, text);
      this.panel.append(row);
    }

    this.legend.className = "world-overlays__legend";
    this.panel.append(this.legend);
    this.status.className = "world-overlays__status";
    this.status.textContent = "Live server overlays load only when enabled.";
    this.panel.append(this.status);

    button.addEventListener("click", () => {
      this.panel.hidden = !this.panel.hidden;
      button.setAttribute("aria-expanded", String(!this.panel.hidden));
    });
    this.host.append(button, this.panel);
    document.body.append(this.host);
  }

  private setEnabled(key: OverlayKey, enabled: boolean): void {
    this.enabled[key] = enabled;
    if (key === "heatmap") {
      preferences.saveHeatmap(enabled);
      document.dispatchEvent(
        new CustomEvent("player-history:heatmap-toggle", { detail: { enabled } }),
      );
      return;
    }

    localStorage.setItem(storageKey(key), String(enabled));
    if (!enabled) this.clearMesh(key);
    if (this.lastSnapshot) this.render(this.lastSnapshot);
    this.updatePolling();
  }

  private updatePolling(): void {
    const active = SERVER_KEYS.some((key) => this.enabled[key]);
    if (!active) {
      if (this.timer !== undefined) window.clearInterval(this.timer);
      this.timer = undefined;
      this.status.textContent = "Live server overlays load only when enabled.";
      return;
    }
    if (this.timer === undefined) {
      void this.refresh();
      this.timer = window.setInterval(() => {
        if (document.visibilityState === "visible") void this.refresh();
      }, 2_000);
    }
  }

  private async refresh(): Promise<void> {
    if (this.loading || !SERVER_KEYS.some((key) => this.enabled[key])) return;
    this.loading = true;
    try {
      if (!this.integration) {
        const response = await fetch(new URL("player-history/integration.json", document.baseURI), {
          cache: "no-cache",
        });
        if (!response.ok) throw new Error(`integration.json HTTP ${response.status}`);
        this.integration = (await response.json()) as Integration;
      }
      const response = await fetch(
        new URL("player-history/server-overlays.json", document.baseURI),
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`server-overlays.json HTTP ${response.status}`);
      const snapshot = (await response.json()) as ServerOverlaySnapshot;
      if (snapshot.version !== 1) throw new Error("Unsupported server overlay version");
      this.lastSnapshot = snapshot;
      this.render(snapshot);
    } catch (error) {
      this.status.textContent =
        error instanceof Error ? `Overlay data unavailable · ${error.message}` : "Overlay data unavailable";
    } finally {
      this.loading = false;
    }
  }

  private currentDimension(): string | undefined {
    const id = this.app.mapViewer.map?.data?.id ?? this.app.mapViewer.map?.id;
    return id ? this.integration?.mapWorlds?.[id] : undefined;
  }

  private render(snapshot: ServerOverlaySnapshot): void {
    const dimension = this.currentDimension();
    const data = dimension ? snapshot.dimensions?.[dimension] : undefined;
    if (!data) {
      for (const key of SERVER_KEYS) this.clearMesh(key);
      this.status.textContent = "No live overlay data for this map.";
      return;
    }

    if (this.enabled.loaded)
      this.setMesh("loaded", data.loaded ?? [], () => this.color("#5aa9e6"), 0.17, 111);
    if (this.enabled.forced)
      this.setMesh("forced", data.forced ?? [], () => this.color("#ffb347"), 0.42, 114);
    if (this.enabled.entities) {
      const rows = data.entities ?? [];
      const max = Math.max(1, ...rows.map((row) => row.total));
      this.setMesh(
        "entities",
        rows,
        (row) => {
          const value = Math.log1p((row as EntityCell).total) / Math.log1p(max);
          return this.api.Three.Color
            ? new this.api.Three.Color().setHSL((1 - value) * 0.33, 1, 0.5)
            : this.color("#ef5350");
        },
        0.42,
        116,
      );
    }
    if (this.enabled.claims) {
      const rows = data.claims ?? [];
      this.setMesh(
        "claims",
        rows,
        (row) => new this.api.Three.Color((row as ClaimCell).color),
        0.24,
        112,
      );
      this.renderClaimLegend(rows);
    } else {
      this.legend.replaceChildren();
    }

    const entityCount = (data.entities ?? []).reduce((sum, row) => sum + row.total, 0);
    const age = Math.max(0, Math.round((Date.now() - snapshot.generatedAt) / 1000));
    this.status.textContent =
      `${data.loaded?.length ?? 0} loaded · ${data.forced?.length ?? 0} forced · ` +
      `${entityCount} entities · ${data.claims?.length ?? 0} claimed chunks · ${age}s old`;
  }

  private renderClaimLegend(rows: ClaimCell[]): void {
    const owners = new Map<string, number>();
    for (const row of rows) owners.set(row.owner, row.color);
    this.legend.replaceChildren();
    for (const [owner, color] of [...owners].slice(0, 12)) {
      const item = document.createElement("span");
      const swatch = document.createElement("i");
      swatch.style.background = `#${color.toString(16).padStart(6, "0").slice(-6)}`;
      item.append(swatch, document.createTextNode(owner));
      this.legend.append(item);
    }
    if (owners.size > 12) {
      const more = document.createElement("small");
      more.textContent = `+${owners.size - 12} more`;
      this.legend.append(more);
    }
  }

  private color(value: string) {
    return new this.api.Three.Color(value);
  }

  private setMesh(
    key: ServerOverlayKey,
    rows: ChunkCell[],
    colorFor: (row: ChunkCell) => { r: number; g: number; b: number },
    opacity: number,
    renderOrder: number,
  ): void {
    this.clearMesh(key);
    if (!rows.length) return;
    const T = this.api.Three;
    const positions: number[] = [];
    const colors: number[] = [];
    const height = (this.app.mapViewer.controlsManager?.position?.y ?? 64) + (renderOrder - 110) * 0.01;
    for (const row of rows) {
      const x = row.x * 16;
      const z = row.z * 16;
      const color = colorFor(row);
      for (const [dx, dz] of [
        [0, 0],
        [1, 1],
        [1, 0],
        [0, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        positions.push(x + dx * 16, height, z + dz * 16);
        colors.push(color.r, color.g, color.b);
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
    const mesh = new T.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    mesh.name = `fpbcraft-overlay-${key}`;
    this.root.add(mesh);
    this.meshes.set(key, mesh);
  }

  private clearMesh(key: ServerOverlayKey): void {
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    this.root.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    this.meshes.delete(key);
  }
}

export const startWorldOverlays = async (): Promise<void> => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const app = window.bluemap as BlueMapApp | undefined;
    const api = window.BlueMap as BlueMapRuntime | undefined;
    if (app?.popupMarkerSet && app?.mapViewer?.markers && api?.MarkerSet && api?.Three) {
      new WorldOverlayController(app, api);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  console.warn("[Player History] BlueMap web API unavailable for world overlays");
};
