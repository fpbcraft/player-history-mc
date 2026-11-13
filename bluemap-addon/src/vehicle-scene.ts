import { readBoundedResponse } from "./vehicle-http.js";
export interface VehiclePose {
  id: string;
  label: string;
  dimension: string;
  mesh: string;
  atlas?: string;
  shadow?: boolean;
  caster?: string;
  icon?: string;
  named?: boolean;
  size?: number;
  group?: string;
  pos: [number, number, number];
  rot: [number, number, number, number];
  scale: [number, number, number];
  travel?: number;
  time?: number;
}
const vector = (value: unknown, size: number): value is number[] =>
  Array.isArray(value) && value.length === size && value.every(Number.isFinite);

export const publicAssetUrl = (path: string, base: string, roots: readonly string[]): string => {
  const url = new URL(path, base),
    origin = new URL(base).origin;
  if (
    /%(?:2f|5c|25)/i.test(url.pathname) ||
    url.origin !== origin ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !roots.some((root) => url.pathname.startsWith(root))
  )
    throw Error("Vehicle asset URL is outside public asset roots");
  return url.href;
};

export const parseVehicleFeed = (
  data: unknown,
  base: string,
): { interval: number; objects: VehiclePose[] } => {
  if (
    !data ||
    typeof data !== "object" ||
    !("objects" in data) ||
    !Array.isArray(data.objects) ||
    data.objects.length > 2000
  )
    throw Error("Invalid vehicle feed");
  const interval =
    "intervalMs" in data && typeof data.intervalMs === "number" && Number.isFinite(data.intervalMs)
      ? Math.max(100, Math.min(2000, data.intervalMs))
      : 1000;
  const seen = new Set<string>();
  const objects = data.objects.flatMap((row: unknown): VehiclePose[] => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      r.id.length > 512 ||
      seen.has(r.id) ||
      typeof r.dimension !== "string" ||
      typeof r.mesh !== "string" ||
      !vector(r.pos, 3) ||
      !vector(r.rot, 4) ||
      r.rot.every((n) => n === 0)
    )
      return [];
    seen.add(r.id);
    try {
      return [
        {
          id: r.id,
          label: typeof r.label === "string" ? r.label.slice(0, 256) : r.id,
          dimension: r.dimension,
          mesh: publicAssetUrl(r.mesh, base, [
            "/assets/bluemap3d/",
            new URL("assets/diorama-vehicles/", base).pathname,
            "/player-history/data/objects/",
          ]),
          ...(typeof r.atlas === "string"
            ? {
                atlas: publicAssetUrl(r.atlas, base, [
                  new URL("assets/diorama-vehicles/", base).pathname,
                  "/assets/bluemap3d/",
                ]),
              }
            : {}),
          ...(r.shadow === true ? { shadow: true } : {}),
          ...(typeof r.caster === "string" && r.caster
            ? {
                caster: publicAssetUrl(r.caster, base, [
                  new URL("assets/diorama-vehicles/", base).pathname,
                ]),
              }
            : {}),
          ...(typeof r.icon === "string"
            ? {
                icon: publicAssetUrl(r.icon, base, [
                  new URL("assets/diorama-markers/", base).pathname,
                ]),
              }
            : {}),
          ...(r.named === true ? { named: true } : {}),
          ...(typeof r.size === "number" && Number.isFinite(r.size) && r.size > 0 && r.size <= 4096
            ? { size: r.size }
            : {}),
          ...(typeof r.group === "string" && r.group.length <= 512 ? { group: r.group } : {}),
          pos: r.pos as VehiclePose["pos"],
          rot: r.rot as VehiclePose["rot"],
          scale: vector(r.scale, 3) ? (r.scale as VehiclePose["scale"]) : [1, 1, 1],
        },
      ];
    } catch {
      return [];
    }
  });
  return { interval, objects };
};

export interface AnimatedPart {
  kind: number;
  start: number;
  count: number;
  pivot: [number, number, number];
  axis: [number, number, number];
  radius: number;
  period: number;
  rate: number;
}
export interface VehicleMesh {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  colors: Uint8Array;
  atlas: string;
  staticCount: number;
  parts: AnimatedPart[];
}
/** Validated BM3D wire format; buffers remain shared, without copying per animated part. */
export const decodeVehicleMesh = (buffer: ArrayBuffer): VehicleMesh => {
  if (buffer.byteLength < 20 || buffer.byteLength > 32 * 1024 * 1024)
    throw Error("Invalid vehicle mesh size");
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== 0x424d3344) throw Error("Invalid vehicle mesh magic");
  const version = view.getUint32(4, true),
    vertices = view.getUint32(8, true),
    count = view.getUint32(12, true),
    length = view.getUint32(16, true);
  if (
    version < 1 ||
    version > 5 ||
    vertices > 500000 ||
    count > 1500000 ||
    count % 3 ||
    length > 4096
  )
    throw Error("Unsupported vehicle mesh");
  let offset = 20;
  const requireBytes = (size: number) => {
    if (offset + size > buffer.byteLength) throw Error("Truncated vehicle mesh");
  };
  requireBytes(length);
  const atlas = new TextDecoder("utf-8", { fatal: true }).decode(
    new Uint8Array(buffer, offset, length),
  );
  offset += (length + 3) & ~3;
  requireBytes(vertices * 20 + count * 4 + ((vertices * 3 + 3) & ~3));
  const positions = new Float32Array(buffer, offset, vertices * 3);
  offset += vertices * 12;
  const uvs = new Float32Array(buffer, offset, vertices * 2);
  offset += vertices * 8;
  const indices = new Uint32Array(buffer, offset, count);
  offset += count * 4;
  const colors = new Uint8Array(buffer, offset, vertices * 3);
  offset = (offset + vertices * 3 + 3) & ~3;
  if (
    !positions.every(Number.isFinite) ||
    !uvs.every(Number.isFinite) ||
    indices.some((i) => i >= vertices)
  )
    throw Error("Invalid vehicle vertices");
  let staticCount = count;
  const parts: AnimatedPart[] = [];
  if (version >= 2) {
    requireBytes(8);
    staticCount = view.getUint32(offset, true);
    const nodes = view.getUint32(offset + 4, true);
    offset += 8;
    if (staticCount > count || staticCount % 3 || nodes > 4096)
      throw Error("Invalid animated mesh ranges");
    for (let i = 0; i < nodes; i++) {
      requireBytes(36 + (version >= 3 ? 8 : 0) + (version >= 4 ? 4 : 0));
      const uint = () => {
        const n = view.getUint32(offset, true);
        offset += 4;
        return n;
      };
      const float = () => {
        const n = view.getFloat32(offset, true);
        offset += 4;
        if (!Number.isFinite(n)) throw Error("Invalid animation value");
        return n;
      };
      const triple = (): [number, number, number] => [float(), float(), float()];
      const kind = version >= 3 ? uint() : 0,
        start = uint(),
        partCount = uint(),
        pivot = triple(),
        axis = triple(),
        radius = float();
      const period = version >= 3 ? float() : 0,
        rate = version >= 4 ? float() : 0;
      if (kind > 3 || start + partCount > count || start % 3 || partCount % 3)
        throw Error("Invalid animation part");
      parts.push({ kind, start, count: partCount, pivot, axis, radius, period, rate });
    }
  }
  return { positions, uvs, indices, colors, atlas, staticCount, parts };
};

export const decodeDepthTile = (buffer: ArrayBuffer, pixels: number): Float32Array => {
  if (pixels <= 0 || pixels > 1024 || buffer.byteLength !== 16 + pixels * pixels * 4)
    throw Error("Invalid depth tile size");
  const view = new DataView(buffer);
  if (
    view.getUint32(0, false) !== 0x44444550 ||
    view.getUint32(4, true) !== 1 ||
    view.getUint32(8, true) !== pixels ||
    view.getUint32(12, true) !== pixels
  )
    throw Error("Unsupported terrain depth");
  return new Float32Array(buffer, 16);
};

/** v2 compresses depth payloads inside the file; works unchanged behind static proxies. */
export const readDepthTile = async (buffer: ArrayBuffer, pixels: number): Promise<Float32Array> => {
  if (buffer.byteLength < 16) throw Error("Truncated terrain depth");
  const view = new DataView(buffer);
  if (view.getUint32(4, true) === 1) return decodeDepthTile(buffer, pixels);
  if (
    view.getUint32(0, false) !== 0x44444550 ||
    view.getUint32(4, true) !== 2 ||
    pixels <= 0 ||
    pixels > 1024 ||
    view.getUint32(8, true) !== pixels ||
    view.getUint32(12, true) !== pixels
  )
    throw Error("Unsupported terrain depth");
  const stream = new Blob([buffer.slice(16)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const body = await readBoundedResponse(new Response(stream), pixels * pixels * 4);
  if (body.byteLength !== pixels * pixels * 4) throw Error("Invalid depth payload");
  return new Float32Array(body);
};
