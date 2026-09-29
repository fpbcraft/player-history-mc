import type { BlueMapApp, BlueMapRuntime, MarkerSet, Object3D } from "./bluemap-types.js";
import { preferences } from "./preferences.js";

type OverlayKey = "heatmap" | "loaded" | "claims" | "entities" | "create" | "tick";
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
  forceLoadMarked?: boolean;
}
interface CreateMachineCell extends ChunkCell {
  machines: number;
  active: number;
  overstressed: number;
  averageRpm: number;
  maxRpm: number;
}
interface TickLoadCell extends ChunkCell {
  mspt: number;
  chunkMspt: number;
  entityMspt: number;
  blockEntityMspt: number;
  entityTicks: number;
  blockEntityTicks: number;
}
interface DimensionData {
  loaded?: ChunkCell[];
  pinned?: ChunkCell[];
  forced?: ChunkCell[];
  entities?: EntityCell[];
  claims?: ClaimCell[];
  create?: CreateMachineCell[];
  tickLoad?: TickLoadCell[];
}
interface ServerOverlaySnapshot {
  version: number;
  generatedAt: number;
  dimensions?: Record<string, DimensionData>;
}
interface Integration {
  mapWorlds?: Record<string, string>;
}

const SERVER_KEYS: ServerOverlayKey[] = ["loaded", "claims", "entities", "create", "tick"];
const storageKey = (key: ServerOverlayKey) => `fpbcraft-map-overlay-${key}`;

class WorldOverlayController {
  private readonly root: MarkerSet;
  private readonly objects = new Map<ServerOverlayKey, Object3D>();
  private readonly enabled: Record<OverlayKey, boolean>;
  private readonly inputs = new Map<OverlayKey, HTMLInputElement>();
  private readonly details = new Map<OverlayKey, HTMLElement>();
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
      entities: localStorage.getItem(storageKey("entities")) === "true",
      create: localStorage.getItem(storageKey("create")) === "true",
      tick: localStorage.getItem(storageKey("tick")) === "true",
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
    document.addEventListener("player-history:range-state", (event) => {
      const label = (event as CustomEvent<{ label?: string }>).detail?.label;
      this.updateHeatmapDescription(label);
    });

    const currentRange =
      document.querySelector<HTMLElement>('bluemap-player-replay [name="range-label"]')?.textContent;
    this.updateHeatmapDescription(currentRange || undefined);
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
      ["heatmap", "Player activity heatmap", "Time spent by recorded players · follows the History range"],
      ["loaded", "Loaded chunks", "Currently loaded chunks · force-load marks outlined in gold"],
      ["claims", "OPAC regions", "Open Parties and Claims ownership"],
      ["entities", "Entity density", "Live entity count by chunk"],
      ["create", "Create machinery", "Live Create/Create-addon machinery in loaded chunks · running / idle / overstressed"],
      ["tick", "Tick load", "Measured chunk contribution to MSPT · chunk + entity + block-entity ticking"],
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
      this.details.set(key, detail);
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

  private updateHeatmapDescription(label?: string): void {
    const detail = this.details.get("heatmap");
    if (!detail) return;
    detail.textContent = label
      ? `Time spent by recorded players · History range: ${label}`
      : "Time spent by recorded players · follows the History range";
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
    if (!enabled) this.clearObject(key);
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
      if (snapshot.version !== 1 && snapshot.version !== 2)
        throw new Error("Unsupported server overlay version");
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
      for (const key of SERVER_KEYS) this.clearObject(key);
      this.status.textContent = "No live overlay data for this map.";
      return;
    }

    const pinned = data.pinned ?? data.forced ?? [];
    if (this.enabled.loaded) {
      this.setArea(
        "loaded",
        data.loaded ?? [],
        () => this.color("#5ab6ff"),
        0.30,
        111,
        () => this.color("#9ed5ff"),
      );
      this.addBoundaryTo(
        "loaded",
        pinned,
        () => this.color("#ffc15a"),
        0.98,
        114,
        () => "force-load",
        2,
      );
    }
    if (this.enabled.entities) {
      const rows = data.entities ?? [];
      const max = Math.max(1, ...rows.map((row) => row.total));
      this.setArea(
        "entities",
        rows,
        (row) => {
          const value = Math.log1p((row as EntityCell).total) / Math.log1p(max);
          return this.api.Three.Color
            ? new this.api.Three.Color().setHSL((1 - value) * 0.33, 1, 0.55)
            : this.color("#ef5350");
        },
        0.52,
        116,
        (row) => {
          const value = Math.log1p((row as EntityCell).total) / Math.log1p(max);
          return new this.api.Three.Color().setHSL((1 - value) * 0.33, 1, 0.68);
        },
      );
    }
    if (this.enabled.claims) {
      const rows = data.claims ?? [];
      this.setArea(
        "claims",
        rows,
        (row) => new this.api.Three.Color((row as ClaimCell).color),
        0.38,
        112,
        (row) => new this.api.Three.Color((row as ClaimCell).color),
        (row) => (row as ClaimCell).owner,
      );
      this.renderClaimLegend(rows);
    } else {
      this.legend.replaceChildren();
    }
    if (this.enabled.create) {
      const rows = data.create ?? [];
      this.setArea(
        "create",
        rows,
        (row) => this.createColor(row as CreateMachineCell),
        0.54,
        118,
        (row) => this.createOutlineColor(row as CreateMachineCell),
      );
    }
    if (this.enabled.tick) {
      const rows = data.tickLoad ?? [];
      const values = rows.map((row) => row.mspt).sort((a, b) => a - b);
      const p95 = values.length
        ? values[Math.min(values.length - 1, Math.floor(values.length * 0.95))]!
        : 1;
      const scale = Math.max(0.01, p95);
      this.setArea(
        "tick",
        rows,
        (row) => this.tickLoadColor(row as TickLoadCell, scale, false),
        0.58,
        120,
        (row) => this.tickLoadColor(row as TickLoadCell, scale, true),
      );
    }

    const entityCount = (data.entities ?? []).reduce((sum, row) => sum + row.total, 0);
    const createRows = data.create ?? [];
    const machineCount = createRows.reduce((sum, row) => sum + row.machines, 0);
    const activeMachines = createRows.reduce((sum, row) => sum + row.active, 0);
    const overstressed = createRows.reduce((sum, row) => sum + row.overstressed, 0);
    const hottestChunk = Math.max(0, ...(data.tickLoad ?? []).map((row) => row.mspt));
    const age = Math.max(0, Math.round((Date.now() - snapshot.generatedAt) / 1000));
    this.status.textContent =
      `${data.loaded?.length ?? 0} loaded · ${pinned.length} force-load marked · ` +
      `${entityCount} entities · ${data.claims?.length ?? 0} claimed · ` +
      `${machineCount} Create machines (${activeMachines} running, ${overstressed} overstressed) · ` +
      `hottest ${hottestChunk.toFixed(2)} mspt · ${age}s old`;
  }

  private tickLoadColor(row: TickLoadCell, scale: number, outline: boolean) {
    const normalized = Math.min(1, Math.log1p(row.mspt * 20) / Math.log1p(scale * 20));
    const color = new this.api.Three.Color();
    color.setHSL((1 - normalized) * 0.66, 1, outline ? 0.68 : 0.52);
    return color;
  }

  private createColor(row: CreateMachineCell) {
    if (row.overstressed > 0) return this.color("#ff5c5c");
    if (row.active > 0) return this.color("#4fd1a1");
    return this.color("#f0b75a");
  }

  private createOutlineColor(row: CreateMachineCell) {
    if (row.overstressed > 0) return this.color("#ffaaaa");
    if (row.active > 0) return this.color("#a9f1d8");
    return this.color("#ffe0a3");
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

  private setArea(
    key: ServerOverlayKey,
    rows: ChunkCell[],
    colorFor: (row: ChunkCell) => { r: number; g: number; b: number },
    opacity: number,
    renderOrder: number,
    outlineColorFor: (row: ChunkCell) => { r: number; g: number; b: number },
    regionFor: (row: ChunkCell) => string = () => "all",
  ): void {
    this.clearObject(key);
    const T = this.api.Three;
    const group = new T.Group();
    group.name = `fpbcraft-overlay-${key}`;

    if (rows.length) {
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
      mesh.name = `fpbcraft-overlay-${key}-fill`;
      group.add(mesh);
      this.addBoundary(group, rows, outlineColorFor, 0.94, renderOrder + 1, regionFor, 1);
    }

    this.root.add(group);
    this.objects.set(key, group);
  }

  private addBoundaryTo(
    key: ServerOverlayKey,
    rows: ChunkCell[],
    colorFor: (row: ChunkCell) => { r: number; g: number; b: number },
    opacity: number,
    renderOrder: number,
    regionFor: (row: ChunkCell) => string = () => "all",
    lineWidth = 1,
  ): void {
    const group = this.objects.get(key);
    if (!group || !rows.length) return;
    this.addBoundary(group, rows, colorFor, opacity, renderOrder, regionFor, lineWidth);
  }

  private addBoundary(
    group: Object3D,
    rows: ChunkCell[],
    colorFor: (row: ChunkCell) => { r: number; g: number; b: number },
    opacity: number,
    renderOrder: number,
    regionFor: (row: ChunkCell) => string,
    lineWidth: number,
  ): void {
    const T = this.api.Three;
    const regions = new Map<string, Map<string, ChunkCell>>();
    for (const row of rows) {
      const region = regionFor(row);
      let cells = regions.get(region);
      if (!cells) regions.set(region, (cells = new Map()));
      cells.set(`${row.x},${row.z}`, row);
    }

    const positions: number[] = [];
    const colors: number[] = [];
    const height = (this.app.mapViewer.controlsManager?.position?.y ?? 64) + (renderOrder - 110) * 0.01;
    const addSegment = (
      row: ChunkCell,
      ax: number,
      az: number,
      bx: number,
      bz: number,
    ) => {
      const color = colorFor(row);
      positions.push(ax, height, az, bx, height, bz);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    };

    for (const cells of regions.values()) {
      for (const row of cells.values()) {
        const x = row.x * 16;
        const z = row.z * 16;
        if (!cells.has(`${row.x},${row.z - 1}`)) addSegment(row, x, z, x + 16, z);
        if (!cells.has(`${row.x + 1},${row.z}`)) addSegment(row, x + 16, z, x + 16, z + 16);
        if (!cells.has(`${row.x},${row.z + 1}`)) addSegment(row, x + 16, z + 16, x, z + 16);
        if (!cells.has(`${row.x - 1},${row.z}`)) addSegment(row, x, z + 16, x, z);
      }
    }

    if (!positions.length) return;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    const material = new T.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      linewidth: lineWidth,
    });
    const lines = new T.LineSegments(geometry, material);
    lines.renderOrder = renderOrder;
    group.add(lines);
  }

  private clearObject(key: ServerOverlayKey): void {
    const object = this.objects.get(key);
    if (!object) return;
    this.root.remove(object);
    this.disposeObject(object);
    this.objects.delete(key);
  }

  private disposeObject(object: Object3D): void {
    for (const child of object.children ?? []) this.disposeObject(child);
    const disposable = object as Object3D & {
      geometry?: { dispose(): void };
      material?: { dispose(): void } | Array<{ dispose(): void }>;
    };
    disposable.geometry?.dispose();
    if (Array.isArray(disposable.material)) disposable.material.forEach((material) => material.dispose());
    else disposable.material?.dispose();
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
