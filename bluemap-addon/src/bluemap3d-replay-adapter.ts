import type { BlueMapRuntime, Object3D } from "./bluemap-types.js";
import type {
  ObjectGeometryEntry,
  ObjectPose,
  ObjectRegistryEntry,
} from "./types.js";

interface BlueMap3DLiveEntry {
  mesh: Object3D | null;
  meshUrl?: string | null;
  dimension?: string;
}

interface BlueMap3DDiagnostics {
  objects: Record<string, BlueMap3DLiveEntry>;
  root: Object3D;
  createReplayMesh?: (url: string, label?: string) => Promise<Object3D>;
  setReplayAnimation?: (mesh: Object3D, travel: number, timeSeconds: number) => void;
  setSuppressedObjects?: (ids: readonly string[]) => void;
}

declare global {
  interface Window {
    __bluemap3d?: BlueMap3DDiagnostics;
  }
}

interface HistoricalMesh {
  key: string;
  source?: Object3D;
  clone: Object3D;
}

export interface ObjectReplayRenderStats {
  rendered: number;
  unavailable: number;
  geometryMismatch: number;
  archived: number;
}

/**
 * Historical BlueMap3D renderer.
 *
 * <p>When the requested geometry version is still live, clone() shares the live mesh's
 * geometry/material. When it is not, Player History asks BlueMap3D to instantiate the
 * durable .bm3d copy from the object geometry archive.
 */
export class BlueMap3DReplayAdapter {
  private root?: Object3D;
  private parentRoot?: Object3D;
  private readonly meshes = new Map<number, HistoricalMesh>();
  private readonly pending = new Map<number, string>();
  private readonly desired = new Map<number, string>();
  private hiddenSources = new Set<Object3D>();
  private suppressedIds = new Set<string>();
  private fallbackFrame?: number;
  private generation = 0;

  constructor(private readonly api: BlueMapRuntime) {}

  setObjects(
    poses: readonly ObjectPose[],
    registry: readonly ObjectRegistryEntry[],
    geometries: readonly ObjectGeometryEntry[] = [],
    archiveBase?: string,
  ): ObjectReplayRenderStats {
    const diagnostics = window.__bluemap3d;
    if (!diagnostics?.root || !diagnostics.objects) {
      this.clear();
      return {
        rendered: 0,
        unavailable: poses.length,
        geometryMismatch: 0,
        archived: 0,
      };
    }

    this.ensureRoot(diagnostics.root);
    const identities = new Map(registry.map((entry) => [entry.id, entry]));

    // Hide exact objects known to history. Providers with variable child topology
    // additionally suppress the whole logical child family so present-day extra
    // segments/knots cannot leak through a historical pose. Do NOT suppress an entire
    // provider: one recorded Create contraption must never hide an unrelated live cable car.
    const exactSuppressed = new Set(
      registry.map((entry) => `${entry.provider}/${entry.sourceId}`),
    );
    const familyPrefixes = new Set(
      registry
        .map((entry) => replayFamilyPrefix(entry.provider, entry.sourceId))
        .filter((value): value is string => value !== null),
    );
    const suppressed = Object.keys(diagnostics.objects).filter(
      (id) =>
        exactSuppressed.has(id) ||
        [...familyPrefixes].some((prefix) => id.startsWith(prefix)),
    );

    // BlueMap3D owns live-object visibility. Suppressing inside its visibility pass avoids
    // the one-frame flash that occurred whenever its polling loop re-applied map visibility
    // after Player History hid a mesh.
    this.syncLiveSuppression(diagnostics, suppressed);

    const archivedByKey = new Map(
      geometries.map((entry) => [
        geometryKey(entry.provider, entry.sourceId, entry.version),
        entry,
      ]),
    );
    const keep = new Set<number>();
    const hiddenNow = new Set<Object3D>();
    let rendered = 0;
    let unavailable = 0;
    let geometryMismatch = 0;
    let archived = 0;

    for (const pose of poses) {
      const identity = identities.get(pose.object);
      if (!identity) {
        unavailable++;
        continue;
      }

      keep.add(pose.object);
      const live = diagnostics.objects[`${identity.provider}/${identity.sourceId}`];
      const source = live?.mesh;
      const liveVersion = geometryVersion(live?.meshUrl);
      const liveMatches =
        !!source && (liveVersion === null || liveVersion === pose.geometry);

      if (source) {
        hiddenNow.add(source);
        // BlueMap3D reapplies live visibility after each poll; suppress it every replay
        // update while a historical representation is selected.
        source.visible = false;
      }

      if (source && liveVersion !== null && liveVersion !== pose.geometry)
        geometryMismatch++;

      if (liveMatches && source) {
        const key = `live:${live?.meshUrl ?? identity.provider + "/" + identity.sourceId}`;
        this.desired.set(pose.object, key);
        let historical = this.meshes.get(pose.object);
        if (!historical || historical.key !== key || historical.source !== source) {
          if (historical) this.root?.remove(historical.clone);
          const clone = source.clone(true);
          prepareClone(clone, identity.label, pose.object);
          this.root?.add(clone);
          historical = { key, source, clone };
          this.meshes.set(pose.object, historical);
        }
        applyPose(historical.clone, pose);
        diagnostics.setReplayAnimation?.(historical.clone, pose.travel, pose.time / 1000);
        rendered++;
        continue;
      }

      const archivedGeometry = archivedByKey.get(
        geometryKey(identity.provider, identity.sourceId, pose.geometry),
      );
      if (
        archivedGeometry &&
        archiveBase &&
        diagnostics.createReplayMesh
      ) {
        archived++;
        const url = new URL(archivedGeometry.mesh, archiveBase).href;
        const key = `archive:${url}`;
        this.desired.set(pose.object, key);

        const historical = this.meshes.get(pose.object);
        if (historical?.key === key) {
          applyPose(historical.clone, pose);
          diagnostics.setReplayAnimation?.(historical.clone, pose.travel, pose.time / 1000);
          rendered++;
        } else {
          if (historical) {
            this.root?.remove(historical.clone);
            this.meshes.delete(pose.object);
          }
          this.loadArchived(
            diagnostics,
            pose.object,
            key,
            url,
            identity.label,
          );
          unavailable++;
        }
        continue;
      }

      this.desired.delete(pose.object);
      unavailable++;
    }

    for (const [object, historical] of this.meshes) {
      if (keep.has(object)) continue;
      this.root?.remove(historical.clone);
      this.meshes.delete(object);
      this.desired.delete(object);
      this.pending.delete(object);
    }

    for (const source of this.hiddenSources) {
      if (!hiddenNow.has(source)) source.visible = true;
    }
    this.hiddenSources = hiddenNow;

    return { rendered, unavailable, geometryMismatch, archived };
  }

  clear(): void {
    this.syncLiveSuppression(window.__bluemap3d, []);
    this.generation++;
    for (const historical of this.meshes.values()) this.root?.remove(historical.clone);
    this.meshes.clear();
    this.pending.clear();
    this.desired.clear();
    for (const source of this.hiddenSources) source.visible = true;
    this.hiddenSources.clear();
  }

  dispose(): void {
    this.clear();
    if (this.root && this.parentRoot) this.parentRoot.remove(this.root);
    this.root = undefined;
    this.parentRoot = undefined;
  }

  private syncLiveSuppression(
    diagnostics: BlueMap3DDiagnostics | undefined,
    ids: readonly string[],
  ): void {
    this.suppressedIds = new Set(ids);

    if (diagnostics?.setSuppressedObjects) {
      diagnostics.setSuppressedObjects(ids);
      this.stopFallbackSuppression();
      return;
    }

    // Older BlueMap3D builds do not own replay suppression. Their feed poll can set a
    // live mesh visible again while Player History is paused between replay updates, so
    // keep the current live copies hidden from the render loop as a compatibility fallback.
    if (this.suppressedIds.size > 0) this.ensureFallbackSuppression();
    else this.stopFallbackSuppression();
  }

  private ensureFallbackSuppression(): void {
    if (
      this.fallbackFrame !== undefined ||
      typeof window.requestAnimationFrame !== "function"
    )
      return;

    const enforce = () => {
      this.fallbackFrame = undefined;
      if (this.suppressedIds.size === 0) return;

      const diagnostics = window.__bluemap3d;
      if (diagnostics?.objects) {
        for (const id of this.suppressedIds) {
          const mesh = diagnostics.objects[id]?.mesh;
          if (mesh) mesh.visible = false;
        }
      }

      if (
        this.suppressedIds.size > 0 &&
        typeof window.requestAnimationFrame === "function"
      )
        this.fallbackFrame = window.requestAnimationFrame(enforce);
    };

    this.fallbackFrame = window.requestAnimationFrame(enforce);
  }

  private stopFallbackSuppression(): void {
    if (this.fallbackFrame === undefined) return;
    if (typeof window.cancelAnimationFrame === "function")
      window.cancelAnimationFrame(this.fallbackFrame);
    this.fallbackFrame = undefined;
  }

  private loadArchived(
    diagnostics: BlueMap3DDiagnostics,
    object: number,
    key: string,
    url: string,
    label: string,
  ): void {
    if (this.pending.get(object) === key || !diagnostics.createReplayMesh) return;
    this.pending.set(object, key);
    const generation = this.generation;

    diagnostics
      .createReplayMesh(url, label)
      .then((clone) => {
        if (
          generation !== this.generation ||
          this.pending.get(object) !== key ||
          this.desired.get(object) !== key ||
          !this.root
        )
          return;

        this.pending.delete(object);
        prepareClone(clone, label, object);
        this.root.add(clone);
        this.meshes.set(object, { key, clone });
      })
      .catch((error: unknown) => {
        if (this.pending.get(object) === key) this.pending.delete(object);
        console.warn("[Player History] Could not load archived BlueMap3D geometry", url, error);
      });
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
    this.pending.clear();
    this.desired.clear();
    this.hiddenSources.clear();
    this.generation++;
  }
}

const applyPose = (mesh: Object3D, pose: ObjectPose): void => {
  mesh.visible = true;
  mesh.position.set(pose.x, pose.y, pose.z);
  mesh.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
  mesh.scale.set(pose.sx, pose.sy, pose.sz);
};

const prepareClone = (clone: Object3D, label: string, object: number): void => {
  clone.name = `history:${label}`;
  clone.userData.playerHistoryObject = object;
};

const replayFamilyPrefix = (provider: string, sourceId: string): string | null => {
  if (provider !== "simulated_ropes" && provider !== "simulated_springs") return null;
  const slash = sourceId.lastIndexOf("/");
  if (slash <= 0) return null;
  return `${provider}/${sourceId.slice(0, slash + 1)}`;
};

const geometryKey = (provider: string, sourceId: string, version: number): string =>
  `${provider}\u0000${sourceId}\u0000${version}`;

const geometryVersion = (meshUrl?: string | null): number | null => {
  if (!meshUrl) return null;
  const match = /-v\d+-(-?\d+)\.bm3d(?:[?#].*)?$/.exec(meshUrl);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
};
