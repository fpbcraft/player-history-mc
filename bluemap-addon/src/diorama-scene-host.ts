import { signedVehicleTravel } from "./vehicle-travel.js";
import { readBoundedResponse } from "./vehicle-http.js";
import type { DioramaApi, OverlayRegistration } from "./diorama-api.js";
import type { DioramaVehicleLayer } from "./diorama-vehicle-layer.js";
import { parseVehicleFeed, publicAssetUrl, type VehiclePose } from "./vehicle-scene.js";
import type { ObjectGeometryEntry, ObjectPose, ObjectRegistryEntry } from "./types.js";

/** Shared live/replay renderer. Consumes existing publications; performs no new server sampling. */
export class DioramaSceneHost {
  private layer: DioramaVehicleLayer | undefined;
  private loading = false;
  private failed = false;
  private live = true;
  private liveRows: VehiclePose[] = [];
  private historyRows: VehiclePose[] = [];
  private previous = new Map<string, VehiclePose>();
  private interval = 1000;
  private receivedAt = 0;
  private expiresAt = 0;
  private frame = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly abort = new AbortController();
  private readonly markers = document.createElement("div");
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly overlay: OverlayRegistration;
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)");
  constructor(
    private readonly api: DioramaApi,
    private readonly feed = new URL("/assets/bluemap3d/entities3d.json", location.origin),
  ) {
    this.markers.className = "diorama-history-markers";
    this.overlay = api.registerOverlay("live-vehicles", { element: this.markers });
    document.addEventListener(
      "player-history:range-state",
      (event) => {
        const live = (event as CustomEvent<{ live?: boolean }>).detail.live;
        if (live !== undefined) this.live = live;
      },
      { signal: this.abort.signal },
    );
    this.frame = requestAnimationFrame((time) => this.draw(time));
    void this.poll();
  }
  private async poll(): Promise<void> {
    if (this.abort.signal.aborted) return;
    try {
      if (document.hidden || !this.live) return;
      const response = await fetch(this.feed, {
        cache: "no-store",
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) throw Error("Live vehicles unavailable");
      const text = new TextDecoder().decode(await readBoundedResponse(response, 2 * 1024 * 1024));
      const json: unknown = JSON.parse(text),
        parsed = parseVehicleFeed(json, new URL("/", this.feed).href);
      const generated =
        typeof json === "object" &&
        json &&
        "generatedAt" in json &&
        typeof json.generatedAt === "number"
          ? json.generatedAt
          : Date.parse(response.headers.get("last-modified") ?? "");
      if (
        !Number.isFinite(generated) ||
        Date.now() - generated > 15000 ||
        generated > Date.now() + 60000
      )
        throw Error("Live vehicle publication is stale or has no timestamp");
      this.previous = new Map(this.liveRows.map((row) => [row.id, row]));
      this.liveRows = parsed.objects.map((row) => {
        const previous = this.previous.get(row.id);
        const delta = row.pos.map((value, index) => value - (previous?.pos[index] ?? value));
        const distance = Math.hypot(...delta);
        const q = previous?.rot ?? row.rot;
        const length = Math.hypot(...q);
        const rotation: [number, number, number, number] = [
          q[0] / length,
          q[1] / length,
          q[2] / length,
          q[3] / length,
        ];
        const travel =
          previous?.dimension === row.dimension && distance < 128
            ? signedVehicleTravel(delta[0] ?? 0, delta[1] ?? 0, delta[2] ?? 0, rotation)
            : 0;
        return { ...row, travel: (previous?.travel ?? 0) + travel };
      });
      this.receivedAt = performance.now();
      this.expiresAt = generated + 15000;
      this.interval = parsed.interval;
    } catch {
      this.liveRows = [];
      this.previous.clear();
      this.interval = Math.min(30000, Math.max(5000, this.interval * 2));
    } finally {
      if (!this.abort.signal.aborted)
        this.timer = setTimeout(() => void this.poll(), this.interval);
    }
  }
  setHistorical(
    poses: ObjectPose[],
    objects: ObjectRegistryEntry[],
    geometries: ObjectGeometryEntry[],
    base: string,
  ): void {
    const state = this.api.getState();
    if (!state) return;
    this.historyRows = poses.flatMap((pose): VehiclePose[] => {
      const object = objects.find((item) => item.id === pose.object);
      const geometry =
        object &&
        geometries.find(
          (item) =>
            item.provider === object.provider &&
            item.sourceId === object.sourceId &&
            item.version === pose.geometry,
        );
      if (!object || !geometry) return [];
      try {
        return [
          {
            id: `history:${pose.object}`,
            label: object.label,
            dimension: state.dimension,
            mesh: publicAssetUrl(geometry.mesh, base, ["/player-history/data/objects/"]),
            atlas: publicAssetUrl(geometry.atlas, base, ["/player-history/data/objects/"]),
            pos: [pose.x, pose.y, pose.z],
            rot: [pose.qx, pose.qy, pose.qz, pose.qw],
            scale: [pose.sx, pose.sy, pose.sz],
            travel: pose.travel,
            time: pose.time,
          },
        ];
      } catch {
        return [];
      }
    });
  }
  clearHistorical(): void {
    this.historyRows = [];
  }
  hasHistorical(id: number): boolean {
    return this.layer?.has(`history:${id}`) ?? false;
  }
  private draw(time: number): void {
    if (this.abort.signal.aborted) return;
    this.frame = requestAnimationFrame((next) => this.draw(next));
    if (document.hidden) return;
    const rows = this.live ? (Date.now() <= this.expiresAt ? this.liveRows : []) : this.historyRows;
    if (rows.length && !this.layer && !this.loading && !this.failed) {
      this.loading = true;
      void import("./diorama-vehicle-layer.js")
        .then(({ DioramaVehicleLayer }) => {
          if (!this.abort.signal.aborted) this.layer = new DioramaVehicleLayer(this.api);
        })
        .catch(() => {
          this.failed = true;
        })
        .finally(() => {
          this.loading = false;
        });
    }
    const alpha = this.reduced.matches
      ? 1
      : Math.max(0, Math.min(1, (time - this.receivedAt) / this.interval));
    this.layer?.render(
      rows,
      this.live ? this.previous : new Map(),
      alpha,
      this.reduced.matches ? 0 : time / 1000,
    );
    const keep = new Set<string>();
    for (const row of this.live ? rows : []) {
      if (row.dimension !== this.api.getState()?.dimension) continue;
      const pixel = this.api.screen({ x: row.pos[0], y: row.pos[1], z: row.pos[2] });
      if (!pixel) continue;
      keep.add(row.id);
      let marker = this.buttons.get(row.id);
      if (!marker) {
        marker = document.createElement("button");
        marker.type = "button";
        marker.className = "diorama-history-marker diorama-object-marker";
        marker.textContent = /train|contraption/.test(row.id) ? "🚂" : "⛵";
        this.markers.append(marker);
        this.buttons.set(row.id, marker);
      }
      marker.title = row.label;
      marker.setAttribute("aria-label", row.label);
      marker.style.transform = `translate(${pixel.x}px,${pixel.y}px) translate(-50%,-50%)`;
      marker.dataset.model = String(this.layer?.has(row.id) ?? false);
    }
    for (const [id, marker] of this.buttons)
      if (!keep.has(id)) {
        marker.remove();
        this.buttons.delete(id);
      }
  }
  dispose(): void {
    this.abort.abort();
    clearTimeout(this.timer);
    cancelAnimationFrame(this.frame);
    this.layer?.dispose();
    this.overlay.remove();
    this.buttons.clear();
  }
}
