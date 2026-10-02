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

  constructor(
    private readonly base: string,
    private readonly cacheFactory: ObjectReplayCacheFactory = (base, duration, ranges) =>
      new ObjectChunkCache(base, duration, undefined, ranges),
  ) {}

  configure(manifest?: ObjectHistoryManifest): void {
    this.manifest = manifest;
    if (!manifest) {
      this.clear();
      return;
    }

    if (!this.cache || this.cache.duration !== manifest.chunkDurationMs) {
      this.generation++;
      this.cache?.clear();
      this.cache = this.cacheFactory(
        this.base,
        manifest.chunkDurationMs,
        manifest.chunkRanges,
      );
      this.engine = new ObjectReplayEngine(
        manifest.positionScale,
        manifest.quaternionScale,
        manifest.scaleScale,
      );
      this.loadedBucket = undefined;
    }
    this.cache.setAvailableRanges(manifest.chunkRanges);
  }

  resetWindow(): void {
    this.generation++;
    this.cache?.clear();
    this.engine.setPoints([]);
    this.loadedBucket = undefined;
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
    this.loadedBucket = Math.floor(window.time / this.cache.duration);
    return true;
  }

  frame(time: number, worldKey?: string): ObjectReplayFrame | undefined {
    const manifest = this.manifest;
    const cache = this.cache;
    if (!manifest || !cache) return undefined;

    const world =
      worldKey === undefined ? -1 : manifest.registry.worlds.indexOf(worldKey);
    const ready = Math.floor(time / cache.duration) === this.loadedBucket;
    return {
      poses: ready && world >= 0 ? this.engine.poses(time, world) : [],
      objects: manifest.registry.objects,
      geometries: manifest.geometries ?? [],
    };
  }

  clear(): void {
    this.generation++;
    this.cache?.clear();
    this.manifest = undefined;
    this.cache = undefined;
    this.engine = new ObjectReplayEngine(32, 32767);
    this.loadedBucket = undefined;
  }
}
