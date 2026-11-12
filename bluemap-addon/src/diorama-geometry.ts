import type { DioramaApi, WorldPosition } from "./diorama-api.js";
import type { HistoryPoint } from "./types.js";

export const historyPosition = (point: HistoryPoint): WorldPosition => ({
  x: point.x / 32,
  y: point.y / 32,
  z: point.z / 32,
});

/** X/Z aggregates have no surface height: explicitly use a reference-height plane. */
export const aggregateCorners = (
  api: DioramaApi,
  x: number,
  z: number,
  size: number,
  height: number,
) =>
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([dx = 0, dz = 0]) => api.screen({ x: x + dx * size, y: height, z: z + dz * size }));

/** Hit-test in CSS pixels, then interpolate the original 3D segment and timestamp. */
export const hitTrail = (
  api: DioramaApi,
  segments: readonly HistoryPoint[][],
  x: number,
  y: number,
  radius = 6,
): HistoryPoint | null => {
  let closest: HistoryPoint | null = null;
  let distance = radius * radius;
  let budget = 50000;
  for (const segment of segments)
    for (let index = 1; index < segment.length && budget-- > 0; index++) {
      const from = segment[index - 1];
      const to = segment[index];
      if (
        !from ||
        !to ||
        from.world !== to.world ||
        from.player !== to.player ||
        to.flags & 1 ||
        from.flags & 2
      )
        continue;
      const a = api.screen(historyPosition(from));
      const b = api.screen(historyPosition(to));
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
      const d = (x - a.x - dx * t) ** 2 + (y - a.y - dy * t) ** 2;
      if (d > distance) continue;
      distance = d;
      closest = {
        ...from,
        time: from.time + (to.time - from.time) * t,
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      };
    }
  return closest;
};
