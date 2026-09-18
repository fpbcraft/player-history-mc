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

interface SkinBox {
  u: number;
  v: number;
  width: number;
  height: number;
  depth: number;
}

interface Limb {
  group: Object3D;
  mesh: Mesh;
  overlay: Mesh;
}

interface PlayerAvatar {
  root: Object3D;
  innerMaterial: Material;
  outerMaterial: Material;
  texture?: Texture;
  parts: Object3D[];
  head: Object3D;
  rightArm: Limb;
  leftArm: Limb;
  rightLeg: Limb;
  leftLeg: Limb;
  last?: HistoryPoint;
  yaw: number;
  phase: number;
  recordedYaw: number | undefined;
  recordedPitch: number | undefined;
}

interface DisposableLine extends Object3D {
  geometry: Geometry;
  material: Material;
}

interface EventMesh extends Object3D {
  geometry: Geometry;
  material: Material;
}

const skinBox = (
  u: number,
  v: number,
  width: number,
  height: number,
  depth: number,
): SkinBox => ({ u, v, width, height, depth });

const PLAYER_HISTORY_SKIN_BUILD = "0.8.21-v12";

const SKIN = {
  head: skinBox(0, 0, 8, 8, 8),
  hat: skinBox(32, 0, 8, 8, 8),
  body: skinBox(16, 16, 8, 12, 4),
  jacket: skinBox(16, 32, 8, 12, 4),
  rightArm: skinBox(40, 16, 4, 12, 4),
  rightSleeve: skinBox(40, 32, 4, 12, 4),
  leftArm: skinBox(32, 48, 4, 12, 4),
  leftSleeve: skinBox(48, 48, 4, 12, 4),
  rightLeg: skinBox(0, 16, 4, 12, 4),
  rightPants: skinBox(0, 32, 4, 12, 4),
  leftLeg: skinBox(16, 48, 4, 12, 4),
  leftPants: skinBox(0, 48, 4, 12, 4),
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
    return this.playersRoot.visible ? [this.playersRoot] : [];
  }

  setPlayersVisible(visible: boolean): void {
    this.playersRoot.visible = visible;
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
      avatar.innerMaterial.dispose();
      avatar.outerMaterial.dispose();
      this.players.delete(id);
    }
  }

  setPlayerVitals(player: number, state: PlayerState = {}): void {
    const avatar = this.players.get(player);
    if (!avatar) return;
    avatar.root.userData.historyVitals = state;
    avatar.recordedYaw =
      typeof state.yaw === "number" && Number.isFinite(state.yaw)
        ? (-state.yaw * Math.PI) / 180
        : undefined;
    avatar.recordedPitch =
      typeof state.pitch === "number" && Number.isFinite(state.pitch)
        ? (state.pitch * Math.PI) / 180
        : undefined;
    const yaw = avatar.recordedYaw ?? avatar.yaw;
    avatar.root.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    const pitch = avatar.recordedPitch ?? 0;
    avatar.head.quaternion.set(Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2));
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
      avatar.innerMaterial.dispose();
      avatar.outerMaterial.dispose();
    }
    this.players.clear();
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    if (this.root.parent) this.root.parent.remove(this.root);
  }

  private createPlayer(id: number, uuid: string | undefined, label: string): PlayerAvatar {
    const T = this.api.Three;
    // Keep Minecraft's two skin layers separate. The base skin is opaque and writes
    // depth first; only the hat/jacket/sleeves/pants layer is transparent. With one
    // transparent DoubleSide material for both, the back face of the hat could render
    // through its transparent front pixels before the actual face had written depth.
    const innerMaterial = new T.MeshBasicMaterial({
      color: uuid ? 0xffffff : playerColor(id),
      transparent: false,
      side: T.FrontSide,
    });
    const outerMaterial = new T.MeshBasicMaterial({
      color: uuid ? 0xffffff : playerColor(id),
      transparent: true,
      alphaTest: 0.00001,
      side: T.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    let texture: Texture | undefined;
    if (uuid) {
      const skinUrl = new URL(`${uuid}.png`, this.skinBase);
      skinUrl.searchParams.set("v", PLAYER_HISTORY_SKIN_BUILD);
      const url = skinUrl.href;
      texture = this.textureLoader.load(
        url,
        (loaded) => {
          // Keep Three.js' normal image-texture orientation. The canonical
          // Minecraft UV mapping below (same as skinview3d) is defined for flipY=true.
          loaded.flipY = true;
          if (T.NearestFilter !== undefined) {
            loaded.magFilter = T.NearestFilter;
            loaded.minFilter = T.NearestFilter;
          }
          loaded.generateMipmaps = false;
          loaded.needsUpdate = true;
          innerMaterial.map = loaded;
          outerMaterial.map = loaded;
          const image = (loaded as unknown as {
            image?: {
              naturalWidth?: number;
              naturalHeight?: number;
              width?: number;
              height?: number;
            };
          }).image;
          console.info("[PlayerHistory3D skin V12]", {
            build: PLAYER_HISTORY_SKIN_BUILD,
            uuid,
            url,
            width: image?.naturalWidth ?? image?.width,
            height: image?.naturalHeight ?? image?.height,
            flipY: loaded.flipY,
          });
          innerMaterial.color?.setStyle?.("#ffffff");
          outerMaterial.color?.setStyle?.("#ffffff");
          innerMaterial.needsUpdate = true;
          outerMaterial.needsUpdate = true;
        },
        undefined,
        (error) => {
          console.warn("[PlayerHistory3D skin V12] failed", {
            build: PLAYER_HISTORY_SKIN_BUILD,
            uuid,
            url,
            error,
          });
          // Skin unavailable: fall back to the same deterministic colour used elsewhere.
          innerMaterial.color?.setStyle?.(playerColor(id));
          outerMaterial.color?.setStyle?.(playerColor(id));
          innerMaterial.needsUpdate = true;
          outerMaterial.needsUpdate = true;
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
      const mesh = new T.Mesh(geometry, innerMaterial);
      mesh.position.set(x, y, z);
      mesh.name = name;
      this.decoratePlayerPart(mesh, id);
      root.add(mesh);
      parts.push(mesh);
      return mesh;
    };

    const head = new T.Group();
    head.position.set(0, 1.75, 0);
    root.add(head);
    for (const [name, geometry, layerMaterial] of [
      ["head", this.geometry("head", 0.5, 0.5, 0.5, SKIN.head), innerMaterial],
      ["hat", this.geometry("hat", 0.54, 0.54, 0.54, SKIN.hat), outerMaterial],
    ] as const) {
      const mesh = new T.Mesh(geometry, layerMaterial);
      mesh.name = name;
      this.decoratePlayerPart(mesh, id);
      head.add(mesh);
      parts.push(mesh);
    }
    addStatic(this.geometry("body", 0.5, 0.75, 0.25, SKIN.body), 0, 1.125, 0, "body");
    {
      const jacket = new T.Mesh(
        this.geometry("jacket", 0.53, 0.78, 0.28, SKIN.jacket),
        outerMaterial,
      );
      jacket.position.set(0, 1.125, 0);
      jacket.name = "jacket";
      this.decoratePlayerPart(jacket, id);
      root.add(jacket);
      parts.push(jacket);
    }

    const limb = (
      key: string,
      overlayKey: string,
      skin: SkinBox,
      overlaySkin: SkinBox,
      x: number,
      pivotY: number,
    ): Limb => {
      const group = new T.Group();
      group.position.set(x, pivotY, 0);
      const mesh = new T.Mesh(
        this.geometry(key, 0.25, 0.75, 0.25, skin),
        innerMaterial,
      );
      const overlay = new T.Mesh(
        this.geometry(overlayKey, 0.28, 0.78, 0.28, overlaySkin),
        outerMaterial,
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
      innerMaterial,
      outerMaterial,
      ...(texture ? { texture } : {}),
      parts,
      head,
      rightArm,
      leftArm,
      rightLeg,
      leftLeg,
      yaw: 0,
      phase: 0,
      recordedYaw: undefined,
      recordedPitch: undefined,
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
    const effectiveYaw = avatar.recordedYaw ?? avatar.yaw;
    const halfYaw = effectiveYaw / 2;
    avatar.root.quaternion.set(0, Math.sin(halfYaw), 0, Math.cos(halfYaw));
    const pitch = avatar.recordedPitch ?? 0;
    avatar.head.quaternion.set(Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2));

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
    skin: SkinBox,
  ): Geometry {
    const cached = this.geometries.get(key);
    if (cached) return cached;

    const T = this.api.Three;
    const geometry = new T.BoxGeometry(width, height, depth);
    const uv = geometry.attributes?.uv;
    if (!uv) {
      throw new Error("BlueMap Three.js BoxGeometry has no UV attribute");
    }

    const { u, v, width: pixelWidth, height: pixelHeight, depth: pixelDepth } = skin;
    const rect = (x1: number, y1: number, x2: number, y2: number) => [
      [x1 / 64, 1 - y2 / 64],
      [x2 / 64, 1 - y2 / 64],
      [x2 / 64, 1 - y1 / 64],
      [x1 / 64, 1 - y1 / 64],
    ] as const;

    const top = rect(
      u + pixelDepth,
      v,
      u + pixelWidth + pixelDepth,
      v + pixelDepth,
    );
    const bottom = rect(
      u + pixelWidth + pixelDepth,
      v,
      u + pixelWidth * 2 + pixelDepth,
      v + pixelDepth,
    );
    const left = rect(
      u,
      v + pixelDepth,
      u + pixelDepth,
      v + pixelDepth + pixelHeight,
    );
    const front = rect(
      u + pixelDepth,
      v + pixelDepth,
      u + pixelWidth + pixelDepth,
      v + pixelDepth + pixelHeight,
    );
    const right = rect(
      u + pixelWidth + pixelDepth,
      v + pixelDepth,
      u + pixelWidth + pixelDepth * 2,
      v + pixelDepth + pixelHeight,
    );
    const back = rect(
      u + pixelWidth + pixelDepth * 2,
      v + pixelDepth,
      u + pixelWidth * 2 + pixelDepth * 2,
      v + pixelDepth + pixelHeight,
    );

    // This is copied from skinview3d's setUVs(): BoxGeometry exposes its six
    // faces in +X, -X, +Y, -Y, +Z, -Z order with four UV vertices per face.
    // Using BoxGeometry directly avoids the remaining face-order mismatch in
    // our previous hand-built cube.
    const ordered = [
      [right[3], right[2], right[0], right[1]],
      [left[3], left[2], left[0], left[1]],
      [top[3], top[2], top[0], top[1]],
      [bottom[0], bottom[1], bottom[3], bottom[2]],
      [front[3], front[2], front[0], front[1]],
      [back[3], back[2], back[0], back[1]],
    ];
    uv.set(new Float32Array(ordered.flat(2)));
    uv.needsUpdate = true;

    this.geometries.set(key, geometry);
    return geometry;
  }

}
