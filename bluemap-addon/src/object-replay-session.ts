import { type GeometryIdentity, ObjectGeometryCatalog } from "./object-geometry-catalog.js";
import { ObjectChunkCache, ObjectReplayEngine } from "./object-replay.js";
import type {
  ObjectGeometryEntry,
  ObjectHistoryManifest,
  ObjectHistoryPoint,
  ObjectPose,
  ObjectRegistryEntry,
} from "./types.js";

interface ObjectReplayCache {
  readonly duration: number;
  setAvailableRanges(ranges?: readonly [number, number][]): void;
  window(time: number): Promise<ObjectHistoryPoint[]>;
  clear(): void;
}

type ObjectReplayCacheFactory = (
  base: string,
  duration: number,
  ranges?: readonly [number, number][],
) => ObjectReplayCache;

export interface ObjectReplayWindow {
  generation: number;
  time: number;
  points: ObjectHistoryPoint[];
}

export interface ObjectReplayFrame {
  poses: ObjectPose[];
  objects: ObjectRegistryEntry[];
  geometries: ObjectGeometryEntry[];
}

export class ObjectReplaySession {
  private generation = 0;
  private manifest: ObjectHistoryManifest | undefined;
  private cache: ObjectReplayCache | undefined;
  private engine = new ObjectReplayEngine(32, 32767);
  private loadedBucket: number | undefined;
  private loadedTimes: [number, number] | undefined;
  private readonly geometryCatalog: ObjectGeometryCatalog;
  private objects = new Map<number, ObjectRegistryEntry>();

  constructor(
    private readonly base: string,
    private readonly cacheFactory: ObjectReplayCacheFactory = (base, duration, ranges) =>
      new ObjectChunkCache(base, duration, undefined, ranges),
  ) {
    this.geometryCatalog = new ObjectGeometryCatalog(base);
  }

  configure(manifest?: ObjectHistoryManifest): void {
    this.manifest = manifest;
    if (!manifest) {
      this.clear();
      return;
    }
    this.objects = new Map(manifest.registry.objects.map((object) => [object.id, object]));

    if (!this.cache || this.cache.duration !== manifest.chunkDurationMs) {
      this.generation++;
      this.cache?.clear();
      this.cache = this.cacheFactory(this.base, manifest.chunkDurationMs, manifest.chunkRanges);
      this.engine = new ObjectReplayEngine(
        manifest.positionScale,
        manifest.quaternionScale,
        manifest.scaleScale,
      );
      this.loadedBucket = undefined;
      this.loadedTimes = undefined;
    }
    this.cache.setAvailableRanges(manifest.chunkRanges);
  }

  resetWindow(): void {
    this.generation++;
    this.cache?.clear();
    this.engine.setPoints([]);
    this.loadedBucket = undefined;
    this.loadedTimes = undefined;
  }

  async window(time: number): Promise<ObjectReplayWindow> {
    const generation = this.generation;
    const cache = this.cache;
    const points = cache ? await cache.window(time) : [];
    return { generation, time, points };
  }

  applyWindow(window: ObjectReplayWindow): boolean {
    if (window.generation !== this.generation || !this.cache) return false;
    this.engine.setPoints(window.points);
    let first = Infinity,
      last = -Infinity;
    for (const point of window.points) {
      first = Math.min(first, point.time);
      last = Math.max(last, point.time);
    }
    this.loadedTimes = first <= last ? [first, last] : undefined;
    this.loadedBucket = Math.floor(window.time / this.cache.duration);
    return true;
  }

  frame(time: number, worldKey?: string): ObjectReplayFrame | undefined {
    const manifest = this.manifest;
    const cache = this.cache;
    if (!manifest || !cache) return undefined;

    const world = worldKey === undefined ? -1 : manifest.registry.worlds.indexOf(worldKey);
    const ready =
      Math.floor(time / cache.duration) === this.loadedBucket ||
      Boolean(this.loadedTimes && time >= this.loadedTimes[0] && time <= this.loadedTimes[1]);
    const poses = ready && world >= 0 ? this.engine.poses(time, world) : [];
    if (manifest.geometryLookup === "sha256-v1") {
      const identities: GeometryIdentity[] = [];
      for (const pose of poses) {
        const object = this.objects.get(pose.object);
        if (!object) continue;
        if (!pose.groups.length)
          identities.push({
            provider: object.provider,
            sourceId: object.sourceId,
            version: pose.geometry,
          });
        for (const group of pose.groups)
          identities.push({
            provider: object.provider,
            sourceId: `${object.sourceId}/@group/${group.id}`,
            version: group.geometry,
          });
      }
      this.geometryCatalog.request(identities);
    }
    return {
      poses,
      objects: manifest.registry.objects,
      geometries:
        manifest.geometryLookup === "sha256-v1"
          ? this.geometryCatalog.geometries
          : (manifest.geometries ?? []),
    };
  }

  clear(): void {
    this.geometryCatalog.clear();
    this.objects.clear();
    this.generation++;
    this.cache?.clear();
    this.manifest = undefined;
    this.cache = undefined;
    this.engine = new ObjectReplayEngine(32, 32767);
    this.loadedBucket = undefined;
    this.loadedTimes = undefined;
  }
}
