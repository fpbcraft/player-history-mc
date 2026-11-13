import * as T from "three";
import type { DepthTile, DioramaApi, DioramaViewport } from "./diorama-api.js";
import type { VehiclePose } from "./vehicle-scene.js";
import { publicBytes } from "./vehicle-http.js";
import {
  decodeShadowGround,
  decodeSunSilhouette,
  type SunSilhouette,
} from "./vehicle-shadow-format.js";
import { vehicleShadowFragment } from "./vehicle-shadow-shader.js";

type Ground = { values: T.DataTexture; color: T.DataTexture; tile: DepthTile; minY: number };
type Caster = { texture: T.DataTexture; shape: SunSilhouette };
type Drawn = T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
const vertex = "varying vec2 tileUv;void main(){tileUv=uv;gl_Position=vec4(position,1.0);}";
const texture = (
  data: Float32Array | Uint8Array,
  width: number,
  height: number,
  rgba: boolean,
): T.DataTexture => {
  const made = new T.DataTexture(
    data,
    width,
    height,
    rgba ? T.RGBAFormat : T.RedFormat,
    data instanceof Float32Array ? T.FloatType : T.UnsignedByteType,
  );
  made.magFilter = made.minFilter = T.NearestFilter;
  made.generateMipmaps = false;
  made.needsUpdate = true;
  return made;
};
/** Frame-by-frame projection of the shared native silhouette; no translated terrain pictures. */
export class VehicleShadowLayer {
  readonly root = new T.Group();
  private readonly grounds = new Map<string, Ground>();
  private readonly casters = new Map<string, Caster>();
  private readonly pending = new Map<string, AbortController>();
  private readonly retry = new Map<string, number>();
  private readonly drawn = new Map<string, Drawn>();
  private wanted = new Set<string>();
  private disposed = false;
  constructor(private readonly api: DioramaApi) {}
  update(rows: readonly VehiclePose[], state: DioramaViewport): void {
    const casting = rows.filter((row) => row.caster).slice(0, 16);
    const tiles = casting.length
      ? (this.api.depthTiles?.() ?? [])
          .filter((tile) => tile.pixels === 512)
          .map((tile) => ({
            tile,
            distance: Math.min(
              ...casting.map((row) => {
                const screen = this.api.screen({ x: row.pos[0], y: row.pos[1], z: row.pos[2] });
                if (!screen) return Infinity;
                const u = state.u + (screen.x - state.width / 2) / state.scale,
                  v = state.v + (screen.y - state.height / 2) / state.scale;
                return Math.hypot(
                  tile.u * tile.units + tile.units / 2 - u,
                  tile.v * tile.units + tile.units / 2 - v,
                );
              }),
            ),
          }))
          .filter((entry) => entry.distance < 384)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 8)
          .map((entry) => entry.tile)
      : [];
    const groundUrl = (tile: DepthTile) => tile.url.replace(/\.depth(?=\?|$)/, ".ground");
    this.wanted = new Set([
      ...tiles.map(groundUrl),
      ...casting.flatMap((row) => (row.caster ? [row.caster] : [])),
    ]);
    for (const [key, request] of this.pending) if (!this.wanted.has(key)) request.abort();
    // Drop dependent meshes before their textures.
    for (const mesh of this.drawn.values()) mesh.visible = false;
    const used = new Set<string>();
    for (const tile of tiles) {
      const key = groundUrl(tile),
        ground = this.grounds.get(key);
      if (!ground) {
        this.loadGround(key, tile);
        continue;
      }
      for (const row of casting) {
        const caster = row.caster && this.casters.get(row.caster);
        if (!caster) {
          if (row.caster) this.loadCaster(row.caster);
          continue;
        }
        const shape = caster.shape;
        const [x, y, z] = row.pos,
          turnedX = [x, z, -x, -z][state.projection.facing] ?? x,
          turnedZ = [z, -x, -z, x][state.projection.facing] ?? z;
        const box = shape.bounds,
          drop = Math.min(192, Math.max(0, y + (box[4] ?? 0) - ground.minY));
        const dx = (-(shape.sun[0] ?? 0) * drop) / (shape.sun[1] ?? 1),
          dz = (-(shape.sun[2] ?? 0) * drop) / (shape.sun[1] ?? 1);
        const { u, v, units } = tile;
        const u0 = Math.max(u * units, turnedX + (box[0] ?? 0) + Math.min(0, dx) - 1),
          u1 = Math.min((u + 1) * units, turnedX + (box[3] ?? 0) + Math.max(0, dx) + 1);
        const v0 = Math.max(
          v * units,
          (turnedZ + (box[2] ?? 0) + Math.min(0, dz)) * state.projection.sin -
            (y + (box[4] ?? 0)) * state.projection.cos -
            1,
        );
        const v1 = Math.min(
          (v + 1) * units,
          (turnedZ + (box[5] ?? 0) + Math.max(0, dz)) * state.projection.sin -
            ground.minY * state.projection.cos +
            1,
        );
        if (u1 <= u0 || v1 <= v0) continue;
        const pair = `${row.id}|${key}`;
        used.add(pair);
        let mesh = this.drawn.get(pair);
        if (!mesh) {
          mesh = this.make();
          this.drawn.set(pair, mesh);
          this.root.add(mesh);
        }
        mesh.visible = true;
        const left = ((u0 - state.u) * state.scale * 2) / state.width,
          top = (-(v0 - state.v) * state.scale * 2) / state.height;
        const right = ((u1 - state.u) * state.scale * 2) / state.width,
          bottom = (-(v1 - state.v) * state.scale * 2) / state.height;
        const position = mesh.geometry.getAttribute("position") as T.BufferAttribute;
        position.array.set([left, top, 0, right, top, 0, right, bottom, 0, left, bottom, 0]);
        position.needsUpdate = true;
        const uv = mesh.geometry.getAttribute("uv") as T.BufferAttribute,
          a = (u0 - u * units) / units,
          b = (v0 - v * units) / units,
          c = (u1 - u * units) / units,
          d = (v1 - v * units) / units;
        uv.array.set([a, b, c, b, c, d, a, d]);
        uv.needsUpdate = true;
        const uniforms = mesh.material.uniforms;
        const values: Record<string, unknown> = {
          ground: ground.values,
          shaded: ground.color,
          silhouette: caster.texture,
          tileOrigin: new T.Vector2(u * units, v * units),
          shapeSize: new T.Vector2(shape.width, shape.height),
          shapeOrigin: new T.Vector2(shape.a0, shape.b0),
          sun: new T.Vector3(...shape.sun),
          e1: new T.Vector3(...shape.e1),
          e2: new T.Vector3(...shape.e2),
          origin: new T.Vector3(
            turnedX + (shape.offset[0] ?? 0),
            y + (shape.offset[1] ?? 0),
            turnedZ + (shape.offset[2] ?? 0),
          ),
          texels: shape.texels,
          pitchSin: state.projection.sin,
          pitchCos: state.projection.cos,
          originDepth: (-state.v * state.projection.cos) / state.projection.sin,
        };
        for (const [name, value] of Object.entries(values))
          if (uniforms[name]) uniforms[name].value = value;
      }
    }
    for (const [key, mesh] of this.drawn)
      if (!used.has(key)) {
        this.root.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this.drawn.delete(key);
      }
    for (const [key, ground] of this.grounds)
      if (!this.wanted.has(key)) {
        ground.values.dispose();
        ground.color.dispose();
        this.grounds.delete(key);
      }
    for (const [key, caster] of this.casters)
      if (!this.wanted.has(key)) {
        caster.texture.dispose();
        this.casters.delete(key);
      }
  }
  private make(): Drawn {
    const geometry = new T.BufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(12), 3));
    geometry.setAttribute("uv", new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    const uniforms = Object.fromEntries(
      [
        "ground",
        "shaded",
        "silhouette",
        "tileOrigin",
        "shapeSize",
        "shapeOrigin",
        "sun",
        "e1",
        "e2",
        "origin",
        "texels",
        "pitchSin",
        "pitchCos",
        "originDepth",
      ].map((name) => [name, { value: null }]),
    );
    const mesh = new T.Mesh(
      geometry,
      new T.ShaderMaterial({
        uniforms,
        vertexShader: vertex,
        fragmentShader: vehicleShadowFragment,
        transparent: true,
        side: T.DoubleSide,
        depthWrite: false,
        depthTest: true,
      }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = -50;
    return mesh;
  }
  private request(key: string, read: (signal: AbortSignal) => Promise<void>): void {
    if (
      this.disposed ||
      this.pending.has(key) ||
      this.pending.size >= 2 ||
      Date.now() < (this.retry.get(key) ?? 0)
    )
      return;
    const abort = new AbortController();
    this.pending.set(key, abort);
    void read(abort.signal)
      .catch(() => {
        this.retry.set(key, Date.now() + 30000);
        if (this.retry.size > 128) this.retry.delete(this.retry.keys().next().value ?? "");
      })
      .finally(() => this.pending.delete(key));
  }
  private loadGround(key: string, tile: DepthTile): void {
    this.request(key, async (signal) => {
      const decoded = await decodeShadowGround(
        await publicBytes(key, signal, 5 * 1024 * 1024),
        tile.pixels,
      );
      if (this.disposed || !this.wanted.has(key) || signal.aborted) return;
      const color = texture(decoded.color, 512, 512, true);
      color.colorSpace = T.SRGBColorSpace;
      this.grounds.set(key, {
        tile,
        minY: decoded.minY,
        values: texture(decoded.ground, 512, 512, true),
        color,
      });
    });
  }
  private loadCaster(key: string): void {
    this.request(key, async (signal) => {
      const shape = await decodeSunSilhouette(await publicBytes(key, signal, 17 * 1024 * 1024));
      if (this.disposed || !this.wanted.has(key) || signal.aborted) return;
      const used = [...this.casters.values()].reduce(
        (sum, caster) => sum + caster.shape.reach.byteLength,
        0,
      );
      if (used + shape.reach.byteLength > 32 * 1024 * 1024)
        throw Error("Shadow texture budget exceeded");
      this.casters.set(key, {
        shape,
        texture: texture(shape.reach, shape.width, shape.height, false),
      });
    });
  }
  dispose(): void {
    this.disposed = true;
    for (const request of this.pending.values()) request.abort();
    for (const mesh of this.drawn.values()) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const ground of this.grounds.values()) {
      ground.values.dispose();
      ground.color.dispose();
    }
    for (const caster of this.casters.values()) caster.texture.dispose();
    this.drawn.clear();
    this.grounds.clear();
    this.casters.clear();
    this.root.clear();
  }
}
