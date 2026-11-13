import { readBoundedResponse } from "./vehicle-http.js";

const inflate = async (bytes: ArrayBuffer, expected: number): Promise<ArrayBuffer> => {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  const body = await readBoundedResponse(new Response(stream), expected);
  if (body.byteLength !== expected) throw Error("Invalid shadow payload size");
  return body;
};
export interface SunSilhouette {
  width: number;
  height: number;
  texels: number;
  a0: number;
  b0: number;
  sun: number[];
  e1: number[];
  e2: number[];
  offset: number[];
  bounds: number[];
  reach: Float32Array;
}
export const decodeSunSilhouette = async (bytes: ArrayBuffer): Promise<SunSilhouette> => {
  if (bytes.byteLength < 128) throw Error("Truncated shadow silhouette");
  const h = new DataView(bytes),
    width = h.getUint32(8, true),
    height = h.getUint32(12, true),
    texels = h.getUint32(16, true);
  if (
    h.getUint32(0, true) !== 0x44485344 ||
    h.getUint32(4, true) !== 1 ||
    !width ||
    !height ||
    width > 4096 ||
    height > 4096 ||
    width * height > 4194304 ||
    ![4, 8].includes(texels)
  )
    throw Error("Invalid shadow silhouette");
  const vector = (at: number) => [0, 4, 8].map((n) => h.getFloat32(at + n, true));
  const result = {
    width,
    height,
    texels,
    a0: h.getFloat64(24, true),
    b0: h.getFloat64(32, true),
    sun: vector(40),
    e1: vector(52),
    e2: vector(64),
    offset: vector(76),
    bounds: [0, 4, 8, 12, 16, 20].map((n) => h.getFloat32(88 + n, true)),
    reach: new Float32Array(await inflate(bytes.slice(128), width * height * 4)),
  };
  if (
    ![
      result.a0,
      result.b0,
      ...result.sun,
      ...result.e1,
      ...result.e2,
      ...result.offset,
      ...result.bounds,
    ].every(Number.isFinite)
  )
    throw Error("Nonfinite shadow silhouette");
  if (
    result.sun[1] === undefined ||
    result.sun[1] <= 0 ||
    [result.sun, result.e1, result.e2].some((axis) => Math.abs(Math.hypot(...axis) - 1) > 1e-4) ||
    [0, 1, 2].some((i) => (result.bounds[i] ?? 0) > (result.bounds[i + 3] ?? 0))
  )
    throw Error("Invalid shadow basis or bounds");
  return result;
};
export const decodeShadowGround = async (
  bytes: ArrayBuffer,
  pixels: number,
): Promise<{ ground: Float32Array; color: Uint8Array; minY: number }> => {
  if (pixels !== 512) throw Error("Unsupported shadow ground dimensions");
  const count = pixels * pixels,
    body = await inflate(bytes, 16 + count * 13),
    view = new DataView(body);
  if (
    view.getUint32(0) !== 0x44475244 ||
    view.getUint32(4) !== 1 ||
    view.getUint32(8) !== pixels ||
    view.getUint32(12) !== pixels
  )
    throw Error("Invalid shadow ground");
  let minY = Infinity;
  const ground = new Float32Array(count * 4),
    color = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const at = 16 + i * 13,
      abgr = view.getUint32(at + 9);
    ground[i * 4] = view.getFloat32(at);
    ground[i * 4 + 1] = view.getFloat32(at + 4);
    ground[i * 4 + 2] = view.getUint8(at + 8) / 255;
    if (Number.isFinite(ground[i * 4])) minY = Math.min(minY, ground[i * 4] ?? Infinity);
    color[i * 4] = abgr & 255;
    color[i * 4 + 1] = (abgr >>> 8) & 255;
    color[i * 4 + 2] = (abgr >>> 16) & 255;
    color[i * 4 + 3] = abgr >>> 24;
  }
  return { ground, color, minY };
};
