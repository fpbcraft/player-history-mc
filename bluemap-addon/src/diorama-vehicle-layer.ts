import * as T from "three";
import type { DioramaApi, OverlayRegistration } from "./diorama-api.js";
import { updateVehicleCamera } from "./diorama-camera.js";
import { VehicleDepthLayer } from "./vehicle-depth-layer.js";
import {
  animateVehicle,
  makeVehicle,
  VehicleResources,
  type VehicleResource,
} from "./vehicle-resources.js";
import type { VehiclePose } from "./vehicle-scene.js";

interface DrawnVehicle {
  root: T.Group;
  resource: VehicleResource;
  key: string;
}
export class DioramaVehicleLayer {
  private readonly renderer: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly camera = new T.OrthographicCamera();
  private readonly resources = new VehicleResources();
  private readonly depth: VehicleDepthLayer;
  private readonly overlay: OverlayRegistration;
  private readonly drawn = new Map<string, DrawnVehicle>();
  private readonly visible = new Set<string>();
  private available = true;
  private size = "";
  private readonly listeners = new AbortController();
  constructor(private readonly api: DioramaApi) {
    this.renderer = new T.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
    });
    this.renderer.setClearColor(0, 0);
    this.renderer.domElement.style.pointerEvents = "none";
    this.renderer.domElement.style.zIndex = "1";
    this.overlay = api.registerOverlay("vehicle-models", { element: this.renderer.domElement });
    this.depth = new VehicleDepthLayer(api);
    this.scene.add(this.depth.root);
    this.renderer.domElement.addEventListener(
      "webglcontextlost",
      (event) => {
        event.preventDefault();
        this.available = false;
        this.visible.clear();
      },
      { signal: this.listeners.signal },
    );
    this.renderer.domElement.addEventListener(
      "webglcontextrestored",
      () => {
        this.available = true;
      },
      { signal: this.listeners.signal },
    );
  }
  has(id: string): boolean {
    return this.visible.has(id);
  }
  render(
    rows: readonly VehiclePose[],
    previous: ReadonlyMap<string, VehiclePose>,
    alpha: number,
    time: number,
  ): void {
    this.visible.clear();
    const state = this.api.getState();
    if (!state || !this.available) return;
    const origin = updateVehicleCamera(this.camera, state);
    const size = `${state.width}:${state.height}:${state.pixelRatio}`;
    if (this.size !== size) {
      this.size = size;
      this.renderer.setPixelRatio(Math.min(2, state.pixelRatio));
      this.renderer.setSize(state.width, state.height, false);
    }
    this.depth.update(state);
    const wanted = rows
      .filter((row) => row.dimension === state.dimension)
      .filter((row) => {
        const screen = this.api.screen({ x: row.pos[0], y: row.pos[1], z: row.pos[2] });
        return (
          screen &&
          screen.x > -256 &&
          screen.y > -256 &&
          screen.x < state.width + 256 &&
          screen.y < state.height + 256
        );
      })
      .slice(0, 128);
    const keys = new Set(wanted.map((row) => row.id));
    for (const [id, entry] of this.drawn)
      if (!keys.has(id)) {
        this.scene.remove(entry.root);
        this.drawn.delete(id);
      }
    this.resources.begin([
      ...wanted.map((row) => `${row.mesh}|${row.atlas ?? ""}`),
      ...[...this.drawn.values()].map((entry) => entry.key),
    ]);
    const rotation = new T.Quaternion(),
      position = new T.Vector3();
    for (const row of wanted) {
      const key = `${row.mesh}|${row.atlas ?? ""}`,
        resource = this.resources.get(row.mesh, row.atlas);
      let entry = this.drawn.get(row.id);
      if (resource && entry?.key !== key) {
        if (entry) this.scene.remove(entry.root);
        entry = { root: makeVehicle(resource), resource, key };
        this.drawn.set(row.id, entry);
        this.scene.add(entry.root);
      }
      if (!entry) continue;
      const from = previous.get(row.id),
        continuous =
          from &&
          from.dimension === row.dimension &&
          new T.Vector3(...from.pos).distanceTo(new T.Vector3(...row.pos)) < 128;
      position.fromArray(row.pos);
      rotation.fromArray(row.rot).normalize();
      if (continuous) {
        position.fromArray(from.pos).lerp(new T.Vector3(...row.pos), alpha);
        rotation
          .fromArray(from.rot)
          .normalize()
          .slerp(new T.Quaternion(...row.rot).normalize(), alpha);
      }
      entry.root.position.copy(position).sub(origin);
      entry.root.quaternion.copy(rotation);
      entry.root.scale.fromArray(row.scale);
      const travel = continuous
        ? (from.travel ?? 0) + ((row.travel ?? 0) - (from.travel ?? 0)) * alpha
        : (row.travel ?? 0);
      animateVehicle(
        entry.root,
        entry.resource.model.parts,
        travel,
        row.time === undefined ? time : row.time / 1000,
      );
      this.visible.add(row.id);
    }
    this.renderer.render(this.scene, this.camera);
    this.renderer.domElement.dataset.vehicleModels = String(this.visible.size);
    this.renderer.domElement.dataset.depthTiles = String(this.depth.root.children.length);
  }
  dispose(): void {
    this.listeners.abort();
    this.resources.dispose();
    this.depth.dispose();
    this.overlay.remove();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.drawn.clear();
  }
}
