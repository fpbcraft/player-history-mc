import { readBoundedResponse } from "./vehicle-http.js";

export interface CraftSprite {
  width: number;
  height: number;
  offsetU: number;
  offsetV: number;
  depth: Float32Array;
  projection?: { sin: number; cos: number; facing: number; pixelsPerUnit: number };
}
/** Lossless output from Diorama's shared in-game/server CraftBaker. */
export const decodeCraftSprite = async (bytes: ArrayBuffer): Promise<CraftSprite> => {
  if (bytes.byteLength < 32) throw Error("Truncated craft sprite");
  const view = new DataView(bytes),
    width = view.getUint32(8, true),
    height = view.getUint32(12, true);
  const offsetU = view.getFloat64(16, true),
    offsetV = view.getFloat64(24, true);
  if (
    view.getUint32(0, false) !== 0x44535052 ||
    ![1, 2].includes(view.getUint32(4, true)) ||
    !width ||
    !height ||
    width > 2048 ||
    height > 2048 ||
    !Number.isFinite(offsetU) ||
    !Number.isFinite(offsetV)
  )
    throw Error("Invalid craft sprite");
  const version = view.getUint32(4, true);
  const header = version === 2 ? 64 : 32;
  if (bytes.byteLength < header) throw Error("Truncated craft projection");
  const projection =
    version === 2
      ? {
          sin: view.getFloat64(32, true),
          cos: view.getFloat64(40, true),
          facing: view.getUint32(48, true),
          pixelsPerUnit: view.getUint32(52, true),
        }
      : undefined;
  if (
    projection &&
    (!Number.isFinite(projection.sin) ||
      !Number.isFinite(projection.cos) ||
      projection.sin <= 0 ||
      projection.cos < 0 ||
      Math.abs(projection.sin ** 2 + projection.cos ** 2 - 1) > 1e-6 ||
      projection.facing > 3 ||
      projection.pixelsPerUnit !== 4)
  )
    throw Error("Invalid craft projection");
  const stream = new Blob([bytes.slice(header)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const payload = await readBoundedResponse(new Response(stream), width * height * 4);
  if (payload.byteLength !== width * height * 4) throw Error("Invalid craft depth payload");
  return {
    width,
    height,
    offsetU,
    offsetV,
    depth: new Float32Array(payload),
    ...(projection ? { projection } : {}),
  };
};
