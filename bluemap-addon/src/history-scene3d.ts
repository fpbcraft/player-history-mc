import type {
  BlueMapRuntime,
  Geometry,
  Material,
  Mesh,
  Object3D,
  Texture,
} from "./bluemap-types.js";
import {
  eventColor,
  formatCoordinates,
  formatTimestamp,
  playerColor,
} from "./event-presentation.js";
import { eventDetails } from "./telemetry.js";
import type {
  HistoryEvent,
  HistoryPoint,
  HistoryRegistry,
  PlayerState,
  PointSegment,
} from "./types.js";

type Rect = readonly [number, number, number, number];
type Face = "top" | "bottom" | "right" | "front" | "left" | "back";
type Faces = Record<Face, Rect>;

interface Limb {
  group: Object3D;
  mesh: Mesh;
  overlay: Mesh;
}

interface PlayerAvatar {
  root: Object3D;
  material: Material;
  texture?: Texture;
  parts: Object3D[];
  rightArm: Limb;
  leftArm: Limb;
  rightLeg: Limb;
  leftLeg: Limb;
  last?: HistoryPoint;
  yaw: number;
  phase: number;
}

interface DisposableLine extends Object3D {
  geometry: Geometry;
  material: Material;
}

interface EventMesh extends Object3D {
  geometry: Geometry;
  material: Material;
}

const skinFaces = (u: number, v: number, w: number, h: number, d: number): Faces => ({
  top: [u + d, v, w, d],
  bottom: [u + d + w, v, w, d],
  right: [u, v + d, d, h],
  front: [u + d, v + d, w, h],
  left: [u + d + w, v + d, d, h],
  back: [u + d + w + d, v + d, w, h],
});

const SKIN = {
  head: skinFaces(0, 0, 8, 8, 8),
  hat: skinFaces(32, 0, 8, 8, 8),
  body: skinFaces(16, 16, 8, 12, 4),
  jacket: skinFaces(16, 32, 8, 12, 4),
  rightArm: skinFaces(40, 16, 4, 12, 4),
  rightSleeve: skinFaces(40, 32, 4, 12, 4),
  leftArm: skinFaces(32, 48, 4, 12, 4),
  leftSleeve: skinFaces(48, 48, 4, 12, 4),
  rightLeg: skinFaces(0, 16, 4, 12, 4),
  rightPants: skinFaces(0, 32, 4, 12, 4),
  leftLeg: skinFaces(16, 48, 4, 12, 4),
  leftPants: skinFaces(0, 48, 4, 12, 4),
} as const;

/**
 * Three.js scene used by Player History for things that should exist in world space:
 * player avatars, trails and event anchors.
 *
 * <p>HTML remains reserved for text-heavy interactions (chat bubbles, timeline and
 * tooltips). Everything here participates in the map's real depth buffer.
 */
export class HistoryScene3D {
  readonly root: Object3D;
  private readonly playersRoot: Object3D;
  private readonly trailsRoot: Object3D;
  private readonly eventsRoot: Object3D;
  private readonly players = new Map<number, PlayerAvatar>();
  private trailLines: DisposableLine[] = [];
  private eventMeshes: EventMesh[] = [];
  private eventGeometry?: Geometry;
  private readonly geometries = new Map<string, Geometry>();
  private readonly textureLoader: InstanceType<BlueMapRuntime["Three"]["TextureLoader"]>;

  constructor(
    private readonly api: BlueMapRuntime,
    private readonly skinBase: string,
  ) {
    this.root = new api.Three.Group();
    this.root.name = "player-history-3d";
    this.root.userData.playerHistory = true;

    this.playersRoot = new api.Three.Group();
    this.playersRoot.name = "player-history-players-3d";
    this.trailsRoot = new api.Three.Group();
    this.trailsRoot.name = "player-history-trails-3d";
    this.eventsRoot = new api.Three.Group();
    this.eventsRoot.name = "player-history-events-3d";
    this.root.add(this.trailsRoot, this.eventsRoot, this.playersRoot);

    this.textureLoader = new api.Three.TextureLoader();
  }

  raycastObjects(): Object3D[] {
    return [this.root];
  }

  setPlayers(
    positions: readonly HistoryPoint[],
    names: ReadonlyMap<number, string>,
    registry: readonly HistoryRegistry["players"][number][],
  ): void {
    const keep = new Set<number>();
    const identities = new Map(registry.map((player) => [player.id, player]));

    for (const point of positions) {
      keep.add(point.player);
      let avatar = this.players.get(point.player);
      if (!avatar) {
        const identity = identities.get(point.player);
        avatar = this.createPlayer(
          point.player,
          identity?.uuid,
          names.get(point.player) ?? String(point.player),
        );
        this.players.set(point.player, avatar);
        this.playersRoot.add(avatar.root);
      }
      this.positionPlayer(
        avatar,
        point,
        names.get(point.player) ?? String(point.player),
      );
    }

    for (const [id, avatar] of this.players) {
      if (keep.has(id)) continue;
      this.playersRoot.remove(avatar.root);
      avatar.texture?.dispose();
      avatar.material.dispose();
      this.players.delete(id);
    }
  }

  setPlayerVitals(player: number, state: PlayerState = {}): void {
    const avatar = this.players.get(player);
    if (avatar) avatar.root.userData.historyVitals = state;
  }

  setTrails(segments: readonly PointSegment[], names: ReadonlyMap<number, string>): void {
    this.clearTrails();
    const T = this.api.Three;

    for (const segment of segments) {
      const first = segment[0];
      if (!first || segment.length < 2) continue;

      const positions = new Float32Array(segment.length * 3);
      for (let i = 0; i < segment.length; i++) {
        const point = segment[i];
        positions[i * 3] = point.x / 32;
        positions[i * 3 + 1] = point.y / 32 + 0.03;
        positions[i * 3 + 2] = point.z / 32;
      }

      const geometry = new T.BufferGeometry();
      geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
      const material = new T.LineBasicMaterial({
        color: playerColor(first.player),
        transparent: true,
        opacity: 0.92,
        depthTest: true,
        depthWrite: false,
      });
      const line = new T.Line(geometry, material) as DisposableLine;
      line.name = "history-trail";
      line.userData.historyKind = "trail";
      line.userData.historyPoints = segment;
      line.userData.historyName = names.get(first.player) ?? String(first.player);
      line.userData.historyPlayer = first.player;
      this.trailsRoot.add(line);
      this.trailLines.push(line);
    }
  }

  setEvents(
    events: readonly HistoryEvent[],
    names: ReadonlyMap<number, string>,
    registry: Partial<HistoryRegistry>,
  ): void {
    this.clearEvents();
    if (!events.length) return;

    const T = this.api.Three;
    this.eventGeometry = new T.SphereGeometry(0.13, 8, 6);
    const groups = new Map<string, HistoryEvent[]>();
    for (const event of events) {
      const color = eventColor(event.type);
      const list = groups.get(color) ?? [];
      list.push(event);
      groups.set(color, list);
    }

    for (const [color, bucket] of groups) {
      const material = new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: true,
      });
      const mesh = new T.InstancedMesh(
        this.eventGeometry,
        material,
        bucket.length,
      ) as EventMesh & {
        instanceMatrix?: { needsUpdate: boolean };
        setMatrixAt(index: number, matrix: { makeTranslation(x: number, y: number, z: number): unknown }): void;
      };
      const tooltips: string[] = [];
      const points: HistoryPoint[] = [];
      for (let i = 0; i < bucket.length; i++) {
        const event = bucket[i];
        const matrix = new T.Matrix4();
        matrix.makeTranslation(
          event.point.x / 32,
          event.point.y / 32 + 0.15,
          event.point.z / 32,
        );
        mesh.setMatrixAt(i, matrix);
        points.push(event.point);

        const label = event.type.toLowerCase().replaceAll("_", " ");
        const details = eventDetails(event.payload, registry, event.type);
        tooltips.push(
          `${names.get(event.point.player) ?? event.point.player} · ${label}\n${formatTimestamp(event.point.time)}\nPosition: ${formatCoordinates(event.point)}${details ? `\n${details}` : ""}`,
        );
      }
      if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true;
      mesh.name = "history-event-anchors";
      mesh.userData.historyKind = "events";
      mesh.userData.historyEventTooltips = tooltips;
      mesh.userData.historyEventPoints = points;
      this.eventsRoot.add(mesh);
      this.eventMeshes.push(mesh);
    }
  }

  clearTrails(): void {
    for (const line of this.trailLines) {
      this.trailsRoot.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    }
    this.trailLines = [];
  }

  clearEvents(): void {
    for (const mesh of this.eventMeshes) {
      this.eventsRoot.remove(mesh);
      mesh.material.dispose();
    }
    this.eventMeshes = [];
    this.eventGeometry?.dispose();
    this.eventGeometry = undefined;
  }

  dispose(): void {
    this.clearTrails();
    this.clearEvents();
    for (const avatar of this.players.values()) {
      avatar.texture?.dispose();
      avatar.material.dispose();
    }
    this.players.clear();
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    if (this.root.parent) this.root.parent.remove(this.root);
  }

  private createPlayer(id: number, uuid: string | undefined, label: string): PlayerAvatar {
    const T = this.api.Three;
    const material = new T.MeshBasicMaterial({
      color: playerColor(id),
      transparent: true,
      alphaTest: 0.08,
      side: T.DoubleSide,
    });
    let texture: Texture | undefined;
    if (uuid) {
      const url = new URL(`${uuid}.png`, this.skinBase).href;
      texture = this.textureLoader.load(
        url,
        (loaded) => {
          loaded.flipY = false;
          if (T.NearestFilter !== undefined) {
            loaded.magFilter = T.NearestFilter;
            loaded.minFilter = T.NearestFilter;
          }
          loaded.generateMipmaps = false;
          material.map = loaded;
          material.needsUpdate = true;
        },
        undefined,
        () => {
          // Keep the player's deterministic fallback colour.
        },
      );
    }

    const root = new T.Group();
    root.name = `history-player:${label}`;
    root.userData.historyKind = "player";
    root.userData.historyPlayer = id;

    const parts: Object3D[] = [];
    const addStatic = (
      geometry: Geometry,
      x: number,
      y: number,
      z: number,
      name: string,
    ): Mesh => {
      const mesh = new T.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.name = name;
      this.decoratePlayerPart(mesh, id);
      root.add(mesh);
      parts.push(mesh);
      return mesh;
    };

    addStatic(this.geometry("head", 0.5, 0.5, 0.5, SKIN.head), 0, 1.75, 0, "head");
    addStatic(this.geometry("hat", 0.54, 0.54, 0.54, SKIN.hat), 0, 1.75, 0, "hat");
    addStatic(this.geometry("body", 0.5, 0.75, 0.25, SKIN.body), 0, 1.125, 0, "body");
    addStatic(
      this.geometry("jacket", 0.53, 0.78, 0.28, SKIN.jacket),
      0,
      1.125,
      0,
      "jacket",
    );

    const limb = (
      key: string,
      overlayKey: string,
      faces: Faces,
      overlayFaces: Faces,
      x: number,
      pivotY: number,
    ): Limb => {
      const group = new T.Group();
      group.position.set(x, pivotY, 0);
      const mesh = new T.Mesh(this.geometry(key, 0.25, 0.75, 0.25, faces), material);
      const overlay = new T.Mesh(
        this.geometry(overlayKey, 0.28, 0.78, 0.28, overlayFaces),
        material,
      );
      mesh.position.set(0, -0.375, 0);
      overlay.position.set(0, -0.375, 0);
      this.decoratePlayerPart(mesh, id);
      this.decoratePlayerPart(overlay, id);
      group.add(mesh, overlay);
      root.add(group);
      parts.push(mesh, overlay);
      return { group, mesh, overlay };
    };

    const rightArm = limb(
      "rightArm",
      "rightSleeve",
      SKIN.rightArm,
      SKIN.rightSleeve,
      -0.375,
      1.5,
    );
    const leftArm = limb(
      "leftArm",
      "leftSleeve",
      SKIN.leftArm,
      SKIN.leftSleeve,
      0.375,
      1.5,
    );
    const rightLeg = limb(
      "rightLeg",
      "rightPants",
      SKIN.rightLeg,
      SKIN.rightPants,
      -0.125,
      0.75,
    );
    const leftLeg = limb(
      "leftLeg",
      "leftPants",
      SKIN.leftLeg,
      SKIN.leftPants,
      0.125,
      0.75,
    );

    return {
      root,
      material,
      ...(texture ? { texture } : {}),
      parts,
      rightArm,
      leftArm,
      rightLeg,
      leftLeg,
      yaw: 0,
      phase: 0,
    };
  }

  private positionPlayer(avatar: PlayerAvatar, point: HistoryPoint, label: string): void {
    const x = point.x / 32;
    const y = point.y / 32;
    const z = point.z / 32;

    let walking = 0;
    if (avatar.last && point.time >= avatar.last.time) {
      const dx = x - avatar.last.x / 32;
      const dz = z - avatar.last.z / 32;
      const distance = Math.hypot(dx, dz);
      const dt = point.time - avatar.last.time;
      if (distance > 0.002 && distance < 4 && dt <= 2000) {
        avatar.yaw = Math.atan2(dx, dz);
        avatar.phase += distance * 7;
        walking = Math.min(0.8, distance * 8);
      } else if (dt > 2000 || point.time < avatar.last.time) {
        avatar.phase = 0;
      }
    }

    avatar.root.position.set(x, y, z);
    const halfYaw = avatar.yaw / 2;
    avatar.root.quaternion.set(0, Math.sin(halfYaw), 0, Math.cos(halfYaw));

    const swing = Math.sin(avatar.phase) * walking;
    this.rotateX(avatar.rightArm.group, swing);
    this.rotateX(avatar.leftArm.group, -swing);
    this.rotateX(avatar.rightLeg.group, -swing);
    this.rotateX(avatar.leftLeg.group, swing);

    const tooltip = `♟ ${label}\n◷ ${formatTimestamp(point.time)}\n⌖ ${formatCoordinates(point)}`;
    avatar.root.userData.historyTooltip = tooltip;
    avatar.root.userData.historyTime = point.time;
    avatar.root.userData.historyPoint = point;
    for (const part of avatar.parts) {
      part.userData.historyTooltip = tooltip;
      part.userData.historyTime = point.time;
      part.userData.historyPoint = point;
    }
    avatar.last = point;
  }

  private rotateX(object: Object3D, angle: number): void {
    const half = angle / 2;
    object.quaternion.set(Math.sin(half), 0, 0, Math.cos(half));
  }

  private decoratePlayerPart(part: Object3D, id: number): void {
    part.userData.historyKind = "player";
    part.userData.historyPlayer = id;
  }

  private geometry(
    key: string,
    width: number,
    height: number,
    depth: number,
    faces: Faces,
  ): Geometry {
    const cached = this.geometries.get(key);
    if (cached) return cached;

    const T = this.api.Three;
    const geometry = new T.BufferGeometry();
    const hx = width / 2;
    const hy = height / 2;
    const hz = depth / 2;

    const facePositions: Record<Face, readonly number[]> = {
      front: [-hx, -hy, hz, hx, -hy, hz, hx, hy, hz, -hx, hy, hz],
      back: [hx, -hy, -hz, -hx, -hy, -hz, -hx, hy, -hz, hx, hy, -hz],
      right: [-hx, -hy, -hz, -hx, -hy, hz, -hx, hy, hz, -hx, hy, -hz],
      left: [hx, -hy, hz, hx, -hy, -hz, hx, hy, -hz, hx, hy, hz],
      top: [-hx, hy, hz, hx, hy, hz, hx, hy, -hz, -hx, hy, -hz],
      bottom: [-hx, -hy, -hz, hx, -hy, -hz, hx, -hy, hz, -hx, -hy, hz],
    };

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const order: Face[] = ["front", "back", "right", "left", "top", "bottom"];

    for (let faceIndex = 0; faceIndex < order.length; faceIndex++) {
      const face = order[faceIndex];
      positions.push(...facePositions[face]);
      const [u, v, w, h] = faces[face];
      const u0 = u / 64;
      const u1 = (u + w) / 64;
      const v0 = 1 - (v + h) / 64;
      const v1 = 1 - v / 64;
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      const base = faceIndex * 4;
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
    geometry.setIndex?.(indices);
    this.geometries.set(key, geometry);
    return geometry;
  }
}
