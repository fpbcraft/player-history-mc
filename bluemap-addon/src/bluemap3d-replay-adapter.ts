import type { BlueMapRuntime, Object3D } from "./bluemap-types.js";
import type { ObjectPose, ObjectRegistryEntry } from "./types.js";

interface BlueMap3DLiveEntry {
  mesh: Object3D | null;
  meshUrl?: string | null;
  dimension?: string;
}

interface BlueMap3DDiagnostics {
  objects: Record<string, BlueMap3DLiveEntry>;
  root: Object3D;
}

declare global {
  interface Window {
    __bluemap3d?: BlueMap3DDiagnostics;
  }
}

interface HistoricalMesh {
  source: Object3D;
  clone: Object3D;
}

export interface ObjectReplayRenderStats {
  rendered: number;
  unavailable: number;
  geometryMismatch: number;
}

/**
 * Best-effort historical renderer backed by BlueMap3D's currently loaded live meshes.
 *
 * <p>Three.js clone() duplicates the transform hierarchy but keeps geometry/material
 * resources shared, so a historical carriage costs only scene nodes, not another copy of
 * its potentially large vertex buffers or texture atlas.
 *
 * <p>This slice intentionally cannot resurrect a geometry version that BlueMap3D has
 * already discarded. geometryMismatch reports that case; durable mesh archiving is the
 * next layer.
 */
export class BlueMap3DReplayAdapter {
  private root?: Object3D;
  private parentRoot?: Object3D;
  private readonly meshes = new Map<number, HistoricalMesh>();
  private hiddenSources = new Set<Object3D>();

  constructor(private readonly api: BlueMapRuntime) {}

  setObjects(
    poses: readonly ObjectPose[],
    registry: readonly ObjectRegistryEntry[],
  ): ObjectReplayRenderStats {
    const diagnostics = window.__bluemap3d;
    if (!diagnostics?.root || !diagnostics.objects) {
      this.clear();
      return { rendered: 0, unavailable: poses.length, geometryMismatch: 0 };
    }

    this.ensureRoot(diagnostics.root);
    const entries = new Map(registry.map((entry) => [entry.id, entry]));
    const keep = new Set<number>();
    const hiddenNow = new Set<Object3D>();
    let rendered = 0;
    let unavailable = 0;
    let geometryMismatch = 0;

    for (const pose of poses) {
      const identity = entries.get(pose.object);
      if (!identity) {
        unavailable++;
        continue;
      }

      const live = diagnostics.objects[`${identity.provider}/${identity.sourceId}`];
      const source = live?.mesh;
      if (!source) {
        unavailable++;
        continue;
      }

      keep.add(pose.object);
      hiddenNow.add(source);
      // Suppress the present-day object while the historical instance is on screen.
      // BlueMap3D may restore it on its next feed poll, so this is intentionally repeated
      // every replay frame.
      source.visible = false;

      let historical = this.meshes.get(pose.object);
      if (!historical || historical.source !== source) {
        if (historical) this.root?.remove(historical.clone);
        const clone = source.clone(true);
        clone.name = `history:${identity.label}`;
        clone.userData.playerHistoryObject = pose.object;
        this.root?.add(clone);
        historical = { source, clone };
        this.meshes.set(pose.object, historical);
      }

      const clone = historical.clone;
      clone.visible = true;
      clone.position.set(pose.x, pose.y, pose.z);
      clone.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
      rendered++;

      const liveVersion = geometryVersion(live?.meshUrl);
      if (liveVersion !== null && liveVersion !== pose.geometry) geometryMismatch++;
    }

    for (const [object, historical] of this.meshes) {
      if (keep.has(object)) continue;
      this.root?.remove(historical.clone);
      this.meshes.delete(object);
    }

    for (const source of this.hiddenSources) {
      if (!hiddenNow.has(source)) source.visible = true;
    }
    this.hiddenSources = hiddenNow;

    return { rendered, unavailable, geometryMismatch };
  }

  clear(): void {
    for (const historical of this.meshes.values()) this.root?.remove(historical.clone);
    this.meshes.clear();
    for (const source of this.hiddenSources) source.visible = true;
    this.hiddenSources.clear();
  }

  dispose(): void {
    this.clear();
    if (this.root && this.parentRoot) this.parentRoot.remove(this.root);
    this.root = undefined;
    this.parentRoot = undefined;
  }

  private ensureRoot(parent: Object3D): void {
    if (this.root && this.parentRoot === parent) return;
    if (this.root && this.parentRoot) this.parentRoot.remove(this.root);

    const root = new this.api.Three.Group();
    root.name = "player-history-bluemap3d-replay";
    root.userData.playerHistory = true;
    parent.add(root);
    this.root = root;
    this.parentRoot = parent;
    this.meshes.clear();
    this.hiddenSources.clear();
  }
}

const geometryVersion = (meshUrl?: string | null): number | null => {
  if (!meshUrl) return null;
  const match = /-v\d+-(-?\d+)\.bm3d(?:[?#].*)?$/.exec(meshUrl);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
};
