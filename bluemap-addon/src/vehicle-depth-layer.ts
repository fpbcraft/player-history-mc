import * as T from "three";
import type { DepthTile, DioramaApi, DioramaViewport } from "./diorama-api.js";
import { readDepthTile } from "./vehicle-scene.js";
import { publicBytes } from "./vehicle-http.js";

export class VehicleDepthLayer {
  readonly root = new T.Group();
  private readonly tiles = new Map<
    string,
    {
      tile: DepthTile;
      layout?: string;
      mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
      texture: T.DataTexture;
    }
  >();
  private readonly pending = new Map<string, AbortController>();
  private readonly retry = new Map<string, number>();
  private wanted = new Set<string>();
  private disposed = false;
  constructor(private readonly api: DioramaApi) {}
  update(state: DioramaViewport): void {
    const tiles = (this.api.depthTiles?.() ?? []).slice(0, 64);
    this.wanted = new Set(tiles.map((tile) => tile.url));
    for (const [key, entry] of this.tiles)
      if (!this.wanted.has(key)) {
        this.root.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
        entry.texture.dispose();
        this.tiles.delete(key);
      }
    for (const [key, request] of this.pending) if (!this.wanted.has(key)) request.abort();
    for (const tile of tiles) {
      const entry = this.tiles.get(tile.url);
      if (!entry) {
        this.load(tile);
        continue;
      }
      const { u, v, units } = tile;
      const left = ((u * units - state.u) * state.scale * 2) / state.width;
      const top = (-((v * units - state.v) * state.scale) * 2) / state.height;
      const right = left + (units * state.scale * 2) / state.width,
        bottom = top - (units * state.scale * 2) / state.height;
      const layout = `${state.u}:${state.v}:${state.scale}:${state.width}:${state.height}`;
      if (entry.layout !== layout) {
        entry.layout = layout;
        const position = entry.mesh.geometry.getAttribute("position") as T.BufferAttribute;
        position.array.set([left, top, 0, right, top, 0, right, bottom, 0, left, bottom, 0]);
        position.needsUpdate = true;
      }
      const uniform = entry.mesh.material.uniforms.originDepth;
      if (uniform) uniform.value = (-state.v * state.projection.cos) / state.projection.sin;
    }
  }
  private load(tile: DepthTile): void {
    if (
      this.disposed ||
      this.pending.has(tile.url) ||
      this.pending.size >= 2 ||
      Date.now() < (this.retry.get(tile.url) ?? 0)
    )
      return;
    const request = new AbortController();
    this.pending.set(tile.url, request);
    void publicBytes(tile.url, request.signal, 5 * 1024 * 1024)
      .then(async (bytes) => {
        if (this.disposed || !this.wanted.has(tile.url)) return;
        const values = await readDepthTile(bytes, tile.pixels);
        if (this.disposed || !this.wanted.has(tile.url)) return;
        const texture = new T.DataTexture(
          values,
          tile.pixels,
          tile.pixels,
          T.RedFormat,
          T.FloatType,
        );
        texture.needsUpdate = true;
        const geometry = new T.BufferGeometry();
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        geometry.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(12), 3));
        geometry.setAttribute("uv", new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        const material = new T.ShaderMaterial({
          side: T.DoubleSide,
          colorWrite: false,
          depthWrite: true,
          depthTest: true,
          depthFunc: T.AlwaysDepth,
          uniforms: { terrain: { value: texture }, originDepth: { value: 0 } },
          vertexShader:
            "varying vec2 tileUv; void main(){tileUv=uv;gl_Position=vec4(position,1.0);}",
          fragmentShader:
            "uniform sampler2D terrain; uniform float originDepth; varying vec2 tileUv; void main(){float d=texture2D(terrain,tileUv).r;if(!(d>-1.0e20&&d<1.0e20))discard;gl_FragDepth=(32768.0+d-originDepth)/65536.0;gl_FragColor=vec4(0.0);}",
        });
        const mesh = new T.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = -1000;
        this.root.add(mesh);
        this.tiles.set(tile.url, { tile, mesh, texture });
      })
      .catch(() => this.retry.set(tile.url, Date.now() + 30000))
      .finally(() => this.pending.delete(tile.url));
  }
  dispose(): void {
    this.disposed = true;
    this.pending.forEach((request) => {
      request.abort();
    });
    this.tiles.forEach((entry) => {
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
      entry.texture.dispose();
    });
    this.tiles.clear();
    this.root.clear();
  }
}
