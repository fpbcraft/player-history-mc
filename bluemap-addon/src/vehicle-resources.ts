import { publicBytes } from "./vehicle-http.js";
import * as T from "three";
import {
  decodeVehicleMesh,
  publicAssetUrl,
  type AnimatedPart,
  type VehicleMesh,
} from "./vehicle-scene.js";

export interface VehicleResource {
  model: VehicleMesh;
  geometry: T.BufferGeometry;
  parts: T.BufferGeometry[];
  material: T.MeshBasicMaterial;
  image: ImageBitmap;
  dispose(): void;
}
const geometryFor = (model: VehicleMesh, start: number, count: number): T.BufferGeometry => {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(model.positions, 3));
  geometry.setAttribute("uv", new T.BufferAttribute(model.uvs, 2));
  geometry.setAttribute("color", new T.BufferAttribute(model.colors, 3, true));
  geometry.setIndex(new T.BufferAttribute(model.indices, 1));
  geometry.setDrawRange(start, count);
  return geometry;
};
const loadResource = async (
  url: string,
  atlas: string | undefined,
  signal: AbortSignal,
): Promise<VehicleResource> => {
  const model = decodeVehicleMesh(await publicBytes(url, signal, 32 * 1024 * 1024));
  const textureUrl = publicAssetUrl(atlas ?? model.atlas, new URL("/", url).href, [
    "/assets/bluemap3d/",
    "/player-history/data/objects/",
  ]);
  const bytes = await publicBytes(textureUrl, signal, 16 * 1024 * 1024),
    header = new DataView(bytes);
  if (
    bytes.byteLength < 24 ||
    header.getUint32(0) !== 0x89504e47 ||
    header.getUint32(16) > 8192 ||
    header.getUint32(20) > 8192 ||
    header.getUint32(16) * header.getUint32(20) > 16 * 1024 * 1024
  )
    throw Error("Invalid vehicle atlas");
  const image = await createImageBitmap(new Blob([bytes]));
  const texture = new T.Texture(image);
  texture.flipY = false;
  texture.colorSpace = T.SRGBColorSpace;
  texture.magFilter = texture.minFilter = T.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const material = new T.MeshBasicMaterial({
    map: texture,
    vertexColors: true,
    side: T.DoubleSide,
    alphaTest: 0.5,
  });
  const geometry = geometryFor(model, 0, model.staticCount),
    parts = model.parts.map((part) => geometryFor(model, part.start, part.count));
  return {
    model,
    geometry,
    parts,
    material,
    image,
    dispose: () => {
      geometry.dispose();
      parts.forEach((part) => {
        part.dispose();
      });
      material.dispose();
      texture.dispose();
      image.close();
    },
  };
};

/** Models are loaded twice concurrently at most, with a small cache and retry backoff. */
export class VehicleResources {
  private readonly ready = new Map<string, VehicleResource>();
  private readonly pending = new Set<string>();
  private readonly retry = new Map<string, number>();
  private active = new Set<string>();
  private readonly abort = new AbortController();
  begin(keys: string[]): void {
    this.active = new Set(keys);
    for (const [key, value] of this.ready)
      if (!this.active.has(key)) {
        value.dispose();
        this.ready.delete(key);
      }
  }
  get(url: string, atlas?: string): VehicleResource | undefined {
    const key = `${url}|${atlas ?? ""}`,
      found = this.ready.get(key);
    if (
      found ||
      this.abort.signal.aborted ||
      this.pending.has(key) ||
      this.pending.size >= 2 ||
      this.ready.size >= 16 ||
      Date.now() < (this.retry.get(key) ?? 0)
    )
      return found;
    this.pending.add(key);
    void loadResource(url, atlas, this.abort.signal)
      .then((resource) => {
        if (this.abort.signal.aborted || !this.active.has(key)) resource.dispose();
        else {
          const bytes = (value: VehicleResource) =>
            value.model.positions.buffer.byteLength + value.image.width * value.image.height * 4;
          const used = [...this.ready.values()].reduce((total, value) => total + bytes(value), 0);
          if (used + bytes(resource) > 128 * 1024 * 1024) {
            resource.dispose();
            this.retry.set(key, Date.now() + 30000);
          } else this.ready.set(key, resource);
        }
      })
      .catch(() => this.retry.set(key, Date.now() + 30000))
      .finally(() => this.pending.delete(key));
    return undefined;
  }
  dispose(): void {
    this.abort.abort();
    this.ready.forEach((value) => {
      value.dispose();
    });
    this.ready.clear();
  }
}

export const makeVehicle = (resource: VehicleResource): T.Group => {
  const root = new T.Group();
  root.add(new T.Mesh(resource.geometry, resource.material));
  for (const [i, part] of resource.model.parts.entries()) {
    const group = new T.Group(),
      mesh = new T.Mesh(resource.parts[i], resource.material);
    if (part.kind !== 1) {
      group.position.fromArray(part.pivot);
      mesh.position.fromArray(part.pivot).negate();
    }
    mesh.frustumCulled = false;
    group.add(mesh);
    root.add(group);
  }
  return root;
};
export const animateVehicle = (
  root: T.Group,
  parts: AnimatedPart[],
  travel: number,
  time: number,
): void => {
  for (const [i, part] of parts.entries()) {
    const group = root.children[i + 1];
    if (!group) continue;
    const axis = new T.Vector3(...part.axis).normalize();
    const forward = part.kind === 1 ? axis.clone() : axis.clone().cross(new T.Vector3(0, 1, 0));
    const sign =
      (Math.abs(forward.z) >= Math.abs(forward.x) ? Math.sign(forward.z) : Math.sign(forward.x)) ||
      1;
    const value = travel * sign;
    if (part.kind === 1)
      group.position
        .copy(axis)
        .multiplyScalar(part.period > 0 ? part.radius * Math.sin(value / part.period) : 0);
    else if (part.kind === 2)
      group.position
        .fromArray(part.pivot)
        .applyAxisAngle(axis, part.period > 0 ? value / part.period : 0);
    else
      group.quaternion.setFromAxisAngle(
        axis,
        part.kind === 3 ? part.rate * time : part.radius > 0 ? value / part.radius : 0,
      );
  }
};
