import * as T from "three";
import type { DioramaApi, DioramaViewport } from "./diorama-api.js";
import type { VehiclePose } from "./vehicle-scene.js";
import {
  loadCraftSprite,
  releaseCraftSprite,
  type CraftSpriteResource as Entry,
} from "./craft-sprite-resource.js";

export class DioramaCraftSprites {
  readonly root = new T.Group();
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, AbortController>();
  private readonly retry = new Map<string, number>();
  private wanted = new Set<string>();
  private disposed = false;
  private readonly shown = new Set<string>();
  private readonly drawn = new Map<
    string,
    { entry: Entry; mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial> }
  >();
  constructor(private readonly api: DioramaApi) {}
  has(id: string): boolean {
    return this.shown.has(id);
  }
  update(
    rows: readonly VehiclePose[],
    previous: ReadonlyMap<string, VehiclePose>,
    alpha: number,
    state: DioramaViewport,
  ): string[] {
    this.shown.clear();
    for (const drawn of this.drawn.values()) drawn.mesh.visible = false;
    const keep = new Set(rows.map((row) => row.id));
    this.wanted = new Set([
      ...rows.map((row) => `${row.mesh}|${row.atlas ?? ""}`),
      ...[...this.drawn].filter(([id]) => keep.has(id)).map(([, drawn]) => drawn.entry.key),
    ]);
    // Keep a bounded LRU across seeks. Empty pending windows must not abort all model loads.
    // One material/texture resource per published image, with an independent mesh per visible row.
    for (const [id, drawn] of this.drawn)
      if (!keep.has(id)) {
        this.drop(drawn.mesh);
        this.drawn.delete(id);
      }
    for (const row of rows) {
      const key = `${row.mesh}|${row.atlas ?? ""}`;
      const found = this.entries.get(key);
      if (found) {
        this.entries.delete(key);
        this.entries.set(key, found);
      }
      if (!found) this.load(row, key);
      const entry = found ?? this.drawn.get(row.id)?.entry;
      if (!entry) continue;
      const projection = entry.sprite.projection;
      if (
        projection &&
        (projection.facing !== state.projection.facing ||
          Math.abs(projection.sin - state.projection.sin) > 1e-5 ||
          Math.abs(projection.cos - state.projection.cos) > 1e-5)
      )
        continue;
      const before = previous.get(row.id);
      const continuous =
        before?.dimension === row.dimension &&
        Math.hypot(...row.pos.map((n, i) => n - (before.pos[i] ?? n))) < 128;
      const pos = row.pos.map((n, i) =>
        continuous ? (before.pos[i] ?? n) + (n - (before.pos[i] ?? n)) * alpha : n,
      );
      const [x = 0, y = 0, z = 0] = pos;
      const screen = this.api.screen({ x, y, z });
      if (!screen) continue;
      const s = entry.sprite,
        left = ((screen.x + s.offsetU * state.scale) / state.width) * 2 - 1,
        top = 1 - ((screen.y + s.offsetV * state.scale) / state.height) * 2;
      const right = left + (((s.width / 4) * state.scale) / state.width) * 2,
        bottom = top - (((s.height / 4) * state.scale) / state.height) * 2;
      let drawn = this.drawn.get(row.id);
      if (drawn?.entry !== entry) {
        if (drawn) this.drop(drawn.mesh);
        const material = entry.mesh.material.clone();
        if (material.uniforms.picture) material.uniforms.picture.value = entry.color;
        if (material.uniforms.near) material.uniforms.near.value = entry.depth;
        const mesh = new T.Mesh(entry.mesh.geometry.clone(), material);
        mesh.frustumCulled = false;
        drawn = { entry, mesh };
        this.drawn.set(row.id, drawn);
        this.root.add(mesh);
      }
      drawn.mesh.visible = true;
      drawn.mesh.renderOrder = row.shadow ? -50 : 0;
      drawn.mesh.material.depthWrite = !row.shadow;
      const geometry = drawn.mesh.geometry,
        material = drawn.mesh.material;
      const position = geometry.getAttribute("position") as T.BufferAttribute;
      position.array.set([left, top, 0, right, top, 0, right, bottom, 0, left, bottom, 0]);
      position.needsUpdate = true;
      const turnedZ = [z, -x, -z, x][state.projection.facing] ?? z;
      if (material.uniforms.anchor)
        material.uniforms.anchor.value =
          -(state.projection.sin * y + state.projection.cos * turnedZ) +
          (state.v * state.projection.cos) / state.projection.sin;
      this.shown.add(row.id);
    }
    return [...this.shown];
  }
  private load(row: VehiclePose, key: string): void {
    this.evict();
    if (
      this.disposed ||
      !row.atlas ||
      this.pending.has(key) ||
      this.pending.size >= 2 ||
      this.entries.size >= 32 ||
      Date.now() < (this.retry.get(key) ?? 0)
    )
      return;
    const abort = new AbortController();
    this.pending.set(key, abort);
    void loadCraftSprite(row.mesh, row.atlas, key, abort.signal)
      .then((entry) => {
        this.evict(entry.sprite.width * entry.sprite.height * 8);
        const used = [...this.entries.values()].reduce(
          (sum, value) => sum + value.sprite.width * value.sprite.height * 8,
          0,
        );
        if (
          this.disposed ||
          used + entry.sprite.width * entry.sprite.height * 8 > 128 * 1024 * 1024
        ) {
          releaseCraftSprite(entry);
          return;
        }
        this.entries.set(key, entry);
      })
      .catch(() => {
        this.retry.set(key, Date.now() + 30000);
        if (this.retry.size > 128) this.retry.delete(this.retry.keys().next().value ?? "");
      })
      .finally(() => this.pending.delete(key));
  }
  private evict(incoming = 0): void {
    let bytes = [...this.entries.values()].reduce(
      (sum, entry) => sum + entry.sprite.width * entry.sprite.height * 8,
      0,
    );
    for (const [key, entry] of this.entries) {
      if (this.entries.size < 32 && bytes + incoming <= 128 * 1024 * 1024) break;
      if (this.wanted.has(key)) continue;
      this.entries.delete(key);
      bytes -= entry.sprite.width * entry.sprite.height * 8;
      this.release(entry);
    }
  }
  private drop(mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>): void {
    this.root.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  private clearDrawn(): void {
    for (const drawn of this.drawn.values()) this.drop(drawn.mesh);
    this.drawn.clear();
  }
  private release(entry: Entry): void {
    releaseCraftSprite(entry);
  }
  dispose(): void {
    this.disposed = true;
    this.pending.forEach((request) => {
      request.abort();
    });
    this.clearDrawn();
    this.entries.forEach((entry) => {
      this.release(entry);
    });
    this.entries.clear();
  }
}
