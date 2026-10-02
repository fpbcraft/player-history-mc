import { parseObjectChunk } from "./protocol.js";
import type { Fetcher, ObjectHistoryPoint, ObjectPose } from "./types.js";

export const OBJECT_OFFLINE = 1;
export const OBJECT_BREAK = 2;
export const OBJECT_CONTEXT = 4;

export const connectsObjects = (from: ObjectHistoryPoint, to: ObjectHistoryPoint): boolean =>
  !(from.flags & OBJECT_OFFLINE) && from.world === to.world && !(to.flags & OBJECT_BREAK);

export const mergeObjectPoints = (chunks: ObjectHistoryPoint[][]): ObjectHistoryPoint[] => {
  const points = chunks.flat();
  const originals = new Set(
    points
      .filter((point) => !(point.flags & OBJECT_CONTEXT))
      .map((point) => `${point.object}:${point.time}`),
  );
  const seen = new Set<string>();
  return points
    .filter((point) => {
      if (
        point.flags & OBJECT_CONTEXT &&
        originals.has(`${point.object}:${point.time}`)
      )
        return false;
      const key = JSON.stringify(point);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.time - right.time);
};

const normalizedQuaternion = (
  point: ObjectHistoryPoint,
  scale: number,
): [number, number, number, number] => {
  let x = point.qx / scale;
  let y = point.qy / scale;
  let z = point.qz / scale;
  let w = point.qw / scale;
  const length = Math.hypot(x, y, z, w);
  if (length < 1e-8) return [0, 0, 0, 1];
  x /= length;
  y /= length;
  z /= length;
  w /= length;
  return [x, y, z, w];
};

const slerp = (
  from: [number, number, number, number],
  target: [number, number, number, number],
  ratio: number,
): [number, number, number, number] => {
  let to = target;
  let dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + from[3] * to[3];
  if (dot < 0) {
    dot = -dot;
    to = [-to[0], -to[1], -to[2], -to[3]];
  }
  dot = Math.max(-1, Math.min(1, dot));

  if (dot > 0.9995) {
    const q: [number, number, number, number] = [
      from[0] + (to[0] - from[0]) * ratio,
      from[1] + (to[1] - from[1]) * ratio,
      from[2] + (to[2] - from[2]) * ratio,
      from[3] + (to[3] - from[3]) * ratio,
    ];
    const length = Math.hypot(...q);
    return length < 1e-8 ? [0, 0, 0, 1] : q.map((value) => value / length) as typeof q;
  }

  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const left = Math.sin((1 - ratio) * theta) / sinTheta;
  const right = Math.sin(ratio * theta) / sinTheta;
  return [
    from[0] * left + to[0] * right,
    from[1] * left + to[1] * right,
    from[2] * left + to[2] * right,
    from[3] * left + to[3] * right,
  ];
};

export class ObjectReplayEngine {
  readonly objects = new Map<number, ObjectHistoryPoint[]>();
  private readonly travel = new Map<number, number[]>();
  private readonly positionScale: number;
  private readonly quaternionScale: number;
  private readonly scaleScale: number;

  constructor(
    positionScale: number,
    quaternionScale: number,
    scaleOrPoints: number | ObjectHistoryPoint[] = 1024,
    points: ObjectHistoryPoint[] = [],
  ) {
    this.positionScale = positionScale;
    this.quaternionScale = quaternionScale;
    if (Array.isArray(scaleOrPoints)) {
      this.scaleScale = 1024;
      this.setPoints(scaleOrPoints);
    } else {
      this.scaleScale = scaleOrPoints;
      this.setPoints(points);
    }
  }

  setPoints(points: ObjectHistoryPoint[]): void {
    this.objects.clear();
    this.travel.clear();
    for (const point of points) {
      const history = this.objects.get(point.object) ?? [];
      history.push(point);
      this.objects.set(point.object, history);
    }
    for (const [id, history] of this.objects) {
      history.sort((left, right) => left.time - right.time);
      const cumulative = new Array<number>(history.length).fill(0);
      for (let i = 1; i < history.length; i++) {
        const from = history[i - 1];
        const to = history[i];
        const previousTravel = cumulative[i - 1];
        if (!from || !to || previousTravel === undefined) continue;
        cumulative[i] =
          previousTravel +
          segmentTravel(from, to, this.positionScale, this.quaternionScale);
      }
      this.travel.set(id, cumulative);
    }
  }

  pose(id: number, time: number): ObjectPose | null {
    const points = this.objects.get(id) ?? [];
    let low = 0;
    let high = points.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const point = points[middle];
      if (point && point.time <= time) low = middle + 1;
      else high = middle;
    }
    if (!low) return null;

    const from = points[low - 1];
    const to = points[low];
    if (!from || from.flags & OBJECT_OFFLINE) return null;

    const fromQ = normalizedQuaternion(from, this.quaternionScale);
    if (!to || !connectsObjects(from, to) || to.time === from.time) {
      return {
        object: from.object,
        time,
        world: from.world,
        x: from.x / this.positionScale,
        y: from.y / this.positionScale,
        z: from.z / this.positionScale,
        qx: fromQ[0],
        qy: fromQ[1],
        qz: fromQ[2],
        qw: fromQ[3],
        sx: from.sx / this.scaleScale,
        sy: from.sy / this.scaleScale,
        sz: from.sz / this.scaleScale,
        geometry: from.geometry,
        travel: this.travelAt(id, low - 1),
      };
    }

    const ratio = Math.max(0, Math.min(1, (time - from.time) / (to.time - from.time)));
    const rotation = slerp(fromQ, normalizedQuaternion(to, this.quaternionScale), ratio);
    return {
      object: from.object,
      time,
      world: from.world,
      x: (from.x + (to.x - from.x) * ratio) / this.positionScale,
      y: (from.y + (to.y - from.y) * ratio) / this.positionScale,
      z: (from.z + (to.z - from.z) * ratio) / this.positionScale,
      qx: rotation[0],
      qy: rotation[1],
      qz: rotation[2],
      qw: rotation[3],
      sx: (from.sx + (to.sx - from.sx) * ratio) / this.scaleScale,
      sy: (from.sy + (to.sy - from.sy) * ratio) / this.scaleScale,
      sz: (from.sz + (to.sz - from.sz) * ratio) / this.scaleScale,
      geometry: from.geometry,
      travel:
        this.travelAt(id, low - 1)
        + segmentTravel(from, to, this.positionScale, this.quaternionScale) * ratio,
    };
  }

  private travelAt(id: number, index: number): number {
    return this.travel.get(id)?.[index] ?? 0;
  }

  poses(time: number, world?: number): ObjectPose[] {
    const result: ObjectPose[] = [];
    for (const id of this.objects.keys()) {
      const pose = this.pose(id, time);
      if (pose && (world === undefined || pose.world === world)) result.push(pose);
    }
    return result;
  }
}

const segmentTravel = (
  from: ObjectHistoryPoint | undefined,
  to: ObjectHistoryPoint | undefined,
  positionScale: number,
  quaternionScale: number,
): number => {
  if (!from || !to || !connectsObjects(from, to)) return 0;
  const dt = Math.max((to.time - from.time) / 1000, 0.001);
  const dx = (to.x - from.x) / positionScale;
  const dy = (to.y - from.y) / positionScale;
  const dz = (to.z - from.z) / positionScale;
  const distance = Math.hypot(dx, dy, dz);
  if (distance > 40 * dt) return 0;

  const q = normalizedQuaternion(from, quaternionScale);
  // Rotate world delta by inverse(from rotation), yielding object-local motion.
  const ix = q[3] * dx - q[1] * dz + q[2] * dy;
  const iy = q[3] * dy - q[2] * dx + q[0] * dz;
  const iz = q[3] * dz - q[0] * dy + q[1] * dx;
  const iw = q[0] * dx + q[1] * dy + q[2] * dz;
  const lx = ix * q[3] + iw * q[0] + iy * q[2] - iz * q[1];
  const lz = iz * q[3] + iw * q[2] + ix * q[1] - iy * q[0];

  // Create carriages can be authored along local X or Z depending on bogey orientation.
  // The dominant horizontal component gives a stable signed odometer for both.
  const sign = Math.abs(lz) >= Math.abs(lx) ? Math.sign(lz) : Math.sign(lx);
  return distance * (sign || 1);
};

export class ObjectChunkCache {
  readonly cache = new Map<number, ObjectHistoryPoint[]>();
  private generation = 0;
  private controller?: AbortController;

  constructor(
    readonly base: string,
    readonly duration: number,
    private readonly fetcher: Fetcher = (...args) => fetch(...args),
    private availableRanges?: readonly [number, number][],
  ) {}

  setAvailableRanges(ranges?: readonly [number, number][]): void {
    this.availableRanges = ranges;
  }

  private isPublished(start: number): boolean {
    if (!this.availableRanges) return true;
    let low = 0;
    let high = this.availableRanges.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const range = this.availableRanges[middle];
      if (!range || start < range[0]) high = middle;
      else if (start >= range[1]) low = middle + 1;
      else return true;
    }
    return false;
  }

  private remember(start: number, points: ObjectHistoryPoint[]): ObjectHistoryPoint[] {
    this.cache.set(start, points);
    while (this.cache.size > 3) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return points;
  }

  async read(start: number, signal?: AbortSignal): Promise<ObjectHistoryPoint[]> {
    const cached = this.cache.get(start);
    if (cached) return cached;
    if (!this.isPublished(start)) return this.remember(start, []);

    const response = await this.fetcher(`${this.base}/chunks/${start}.json`, {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok && response.status !== 404)
      throw new Error(`Object history HTTP ${response.status}`);
    if (response.status === 404) return this.remember(start, []);
    if (!response.text) throw new Error("Object-history chunk response is not text");
    const text = await response.text();
    if (text.length > 64 * 1024 * 1024) throw new Error("Object-history chunk is too large");
    const points = parseObjectChunk(JSON.parse(text) as unknown);
    if (signal?.aborted) throw new DOMException("Obsolete read", "AbortError");
    return this.remember(start, points);
  }

  async window(time: number): Promise<ObjectHistoryPoint[]> {
    this.controller?.abort();
    this.controller = new AbortController();
    const generation = ++this.generation;
    const start = Math.floor(time / this.duration) * this.duration;
    const chunks = await Promise.all(
      [start - this.duration, start, start + this.duration].map((value) =>
        this.read(value, this.controller?.signal),
      ),
    );
    if (generation !== this.generation) throw new DOMException("Obsolete seek", "AbortError");
    const current = chunks[1] ?? [];
    return current.length ? mergeObjectPoints(chunks) : [];
  }

  clear(): void {
    this.generation++;
    this.controller?.abort();
    this.cache.clear();
  }
}
