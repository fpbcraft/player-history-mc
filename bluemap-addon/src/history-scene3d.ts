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
import {
  type BuiltEquipmentModel,
  EquipmentModelLoader,
  type LoadedArmorModel,
} from "./equipment-model-loader.js";
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

interface ResolvedItem {
  key: string;
  color?: number;
}

interface WearableVisual {
  slot: string;
  index: number;
  item: ResolvedItem;
}

interface PlayerAvatar {
  root: Object3D;
  model: Object3D;
  torso: Object3D;
  innerMaterial: Material;
  outerMaterial: Material;
  texture?: Texture;
  parts: Object3D[];
  equipmentParts: Object3D[];
  equipmentMaterials: Material[];
  equipmentGeometries: Geometry[];
  head: Object3D;
  rightArm: Limb;
  leftArm: Limb;
  rightLeg: Limb;
  leftLeg: Limb;
  last?: HistoryPoint;
  yaw: number;
  phase: number;
  walking: number;
  recordedYaw: number | undefined;
  recordedBodyYaw: number | undefined;
  recordedPitch: number | undefined;
  state: PlayerState;
  equipmentSignature: string;
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

declare const __PLAYER_HISTORY_VERSION__: string;

const PLAYER_HISTORY_SKIN_BUILD =
  typeof __PLAYER_HISTORY_VERSION__ === "undefined" ? "" : __PLAYER_HISTORY_VERSION__;

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

type ArmorSlot = "head" | "chest" | "legs" | "feet";
type ArmorParent = "head" | "torso" | "rightArm" | "leftArm" | "rightLeg" | "leftLeg";

interface ArmorPartSpec {
  parent: ArmorParent;
  uv: SkinBox;
  position: readonly [number, number, number];
  scale: number;
  name: string;
}

interface ArmorFallbackSpec {
  parent: ArmorParent;
  size: readonly [number, number, number];
  position: readonly [number, number, number];
  name: string;
}

const ARMOR_PARTS: Record<ArmorSlot, readonly ArmorPartSpec[]> = {
  head: [{ parent: "head", uv: SKIN.head, position: [0, 0.25, 0], scale: 1.14, name: "helmet" }],
  chest: [
    { parent: "torso", uv: SKIN.body, position: [0, -0.375, 0], scale: 1.08, name: "chestplate" },
    { parent: "rightArm", uv: SKIN.rightArm, position: [0, -0.375, 0], scale: 1.08, name: "right-arm-armor" },
    { parent: "leftArm", uv: SKIN.rightArm, position: [0, -0.375, 0], scale: 1.08, name: "left-arm-armor" },
  ],
  legs: [
    { parent: "torso", uv: SKIN.body, position: [0, -0.375, 0], scale: 1.04, name: "leggings-waist" },
    { parent: "rightLeg", uv: SKIN.rightLeg, position: [0, -0.375, 0], scale: 1.08, name: "right-leg-armor" },
    { parent: "leftLeg", uv: SKIN.rightLeg, position: [0, -0.375, 0], scale: 1.08, name: "left-leg-armor" },
  ],
  feet: [
    { parent: "rightLeg", uv: SKIN.rightLeg, position: [0, -0.375, 0], scale: 1.1, name: "right-boot" },
    { parent: "leftLeg", uv: SKIN.rightLeg, position: [0, -0.375, 0], scale: 1.1, name: "left-boot" },
  ],
};

const ARMOR_FALLBACKS: Record<ArmorSlot, readonly ArmorFallbackSpec[]> = {
  head: [{ parent: "head", size: [0.59, 0.59, 0.59], position: [0, 0.25, 0], name: "helmet" }],
  chest: [{ parent: "torso", size: [0.59, 0.82, 0.32], position: [0, -0.375, 0], name: "chestplate" }],
  legs: [
    { parent: "rightLeg", size: [0.29, 0.43, 0.29], position: [0, -0.25, 0], name: "right-leg-armor" },
    { parent: "leftLeg", size: [0.29, 0.43, 0.29], position: [0, -0.25, 0], name: "left-leg-armor" },
  ],
  feet: [
    { parent: "rightLeg", size: [0.3, 0.32, 0.31], position: [0, -0.58, 0.02], name: "right-boot" },
    { parent: "leftLeg", size: [0.3, 0.32, 0.31], position: [0, -0.58, 0.02], name: "left-boot" },
  ],
};

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
  private eventGeometry: Geometry | undefined;
  private readonly geometries = new Map<string, Geometry>();
  private readonly textureLoader: InstanceType<BlueMapRuntime["Three"]["TextureLoader"]>;
  private readonly equipmentModels: EquipmentModelLoader | undefined;

  constructor(
    private readonly api: BlueMapRuntime,
    private readonly skinBase: string,
    equipmentBase?: string,
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
    this.equipmentModels = equipmentBase
      ? new EquipmentModelLoader(
          api,
          equipmentBase,
          (input) => fetch(input),
          PLAYER_HISTORY_SKIN_BUILD,
        )
      : undefined;
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
      this.clearEquipment(avatar);
      avatar.texture?.dispose();
      avatar.innerMaterial.dispose();
      avatar.outerMaterial.dispose();
      this.players.delete(id);
    }
  }

  setPlayerVitals(
    player: number,
    state: PlayerState = {},
    items: readonly HistoryRegistry["items"][number][] = [],
  ): void {
    const avatar = this.players.get(player);
    if (!avatar) return;
    avatar.root.userData.historyVitals = state;
    avatar.state = state;
    const headYaw =
      typeof state.headYaw === "number" && Number.isFinite(state.headYaw)
        ? state.headYaw
        : state.yaw;
    avatar.recordedYaw =
      typeof headYaw === "number" && Number.isFinite(headYaw)
        ? (-headYaw * Math.PI) / 180
        : undefined;
    avatar.recordedBodyYaw =
      typeof state.bodyYaw === "number" && Number.isFinite(state.bodyYaw)
        ? (-state.bodyYaw * Math.PI) / 180
        : undefined;
    avatar.recordedPitch =
      typeof state.pitch === "number" && Number.isFinite(state.pitch)
        ? (state.pitch * Math.PI) / 180
        : undefined;
    this.updateEquipment(avatar, state, items);
    this.applyPose(avatar);
  }

  setTrails(segments: readonly PointSegment[], names: ReadonlyMap<number, string>): void {
    this.clearTrails();
    const T = this.api.Three;

    for (const segment of segments) {
      const first = segment[0];
      if (!first || segment.length < 2) continue;

      const positions = new Float32Array(segment.length * 3);
      for (const [i, point] of segment.entries()) {
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
      for (const [i, event] of bucket.entries()) {
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
      this.clearEquipment(avatar);
      avatar.texture?.dispose();
      avatar.innerMaterial.dispose();
      avatar.outerMaterial.dispose();
    }
    this.players.clear();
    this.equipmentModels?.dispose();
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
    if (this.root.parent) this.root.parent.remove(this.root);
  }

  private createPlayer(id: number, uuid: string | undefined, label: string): PlayerAvatar {
    const T = this.api.Three;
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
      if (PLAYER_HISTORY_SKIN_BUILD)
        skinUrl.searchParams.set("v", PLAYER_HISTORY_SKIN_BUILD);
      texture = this.textureLoader.load(
        skinUrl.href,
        (loaded) => {
          loaded.flipY = true;
          if (T.NearestFilter !== undefined) {
            loaded.magFilter = T.NearestFilter;
            loaded.minFilter = T.NearestFilter;
          }
          loaded.generateMipmaps = false;
          loaded.needsUpdate = true;
          innerMaterial.map = loaded;
          outerMaterial.map = loaded;
          innerMaterial.color?.setStyle?.("#ffffff");
          outerMaterial.color?.setStyle?.("#ffffff");
          innerMaterial.needsUpdate = true;
          outerMaterial.needsUpdate = true;
        },
        undefined,
        () => {
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

    const model = new T.Group();
    model.name = "player-model";
    root.add(model);

    const parts: Object3D[] = [];
    const addMesh = (
      parent: Object3D,
      geometry: Geometry,
      material: Material,
      x: number,
      y: number,
      z: number,
      name: string,
    ): Mesh => {
      const mesh = new T.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.name = name;
      this.decoratePlayerPart(mesh, id);
      parent.add(mesh);
      parts.push(mesh);
      return mesh;
    };

    // Minecraft's HumanoidModel rotates the head from the neck and the torso
    // from the shoulders. Keep the cuboids offset below those pivots rather
    // than rotating them around their geometric centers.
    const head = new T.Group();
    head.position.set(0, 1.5, 0);
    model.add(head);
    addMesh(head, this.geometry("head", 0.5, 0.5, 0.5, SKIN.head), innerMaterial, 0, 0.25, 0, "head");
    addMesh(head, this.geometry("hat", 0.54, 0.54, 0.54, SKIN.hat), outerMaterial, 0, 0.25, 0, "hat");

    const torso = new T.Group();
    torso.position.set(0, 1.5, 0);
    model.add(torso);
    addMesh(torso, this.geometry("body", 0.5, 0.75, 0.25, SKIN.body), innerMaterial, 0, -0.375, 0, "body");
    addMesh(torso, this.geometry("jacket", 0.53, 0.78, 0.28, SKIN.jacket), outerMaterial, 0, -0.375, 0, "jacket");

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
      const mesh = addMesh(
        group,
        this.geometry(key, 0.25, 0.75, 0.25, skin),
        innerMaterial,
        0,
        -0.375,
        0,
        key,
      );
      const overlay = addMesh(
        group,
        this.geometry(overlayKey, 0.28, 0.78, 0.28, overlaySkin),
        outerMaterial,
        0,
        -0.375,
        0,
        overlayKey,
      );
      model.add(group);
      return { group, mesh, overlay };
    };

    const rightArm = limb("rightArm", "rightSleeve", SKIN.rightArm, SKIN.rightSleeve, -0.375, 1.5);
    const leftArm = limb("leftArm", "leftSleeve", SKIN.leftArm, SKIN.leftSleeve, 0.375, 1.5);
    const rightLeg = limb("rightLeg", "rightPants", SKIN.rightLeg, SKIN.rightPants, -0.125, 0.75);
    const leftLeg = limb("leftLeg", "leftPants", SKIN.leftLeg, SKIN.leftPants, 0.125, 0.75);

    return {
      root,
      model,
      torso,
      innerMaterial,
      outerMaterial,
      ...(texture ? { texture } : {}),
      parts,
      equipmentParts: [],
      equipmentMaterials: [],
      equipmentGeometries: [],
      head,
      rightArm,
      leftArm,
      rightLeg,
      leftLeg,
      yaw: 0,
      phase: 0,
      walking: 0,
      recordedYaw: undefined,
      recordedBodyYaw: undefined,
      recordedPitch: undefined,
      state: {},
      equipmentSignature: "",
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
    avatar.walking = walking;
    avatar.root.position.set(x, y, z);
    this.applyPose(avatar);

    const tooltip = `♟ ${label}\n◷ ${formatTimestamp(point.time)}\n⌖ ${formatCoordinates(point)}`;
    avatar.root.userData.historyTooltip = tooltip;
    avatar.root.userData.historyTime = point.time;
    avatar.root.userData.historyPoint = point;
    for (const part of [...avatar.parts, ...avatar.equipmentParts]) {
      part.userData.historyTooltip = tooltip;
      part.userData.historyTime = point.time;
      part.userData.historyPoint = point;
    }
    avatar.last = point;
  }

  private applyPose(avatar: PlayerAvatar): void {
    const state = avatar.state;
    const sneaking = state.sneaking === true;
    const swimming = state.swimming === true;
    const elytra = state.elytra === true;
    const sleeping = state.sleeping === true;
    const airborne = state.onGround === false && !swimming && !elytra && !sleeping;

    const viewYaw = avatar.recordedYaw ?? avatar.yaw;
    const bodyYaw = avatar.recordedBodyYaw ?? viewYaw;
    avatar.root.quaternion.set(
      0,
      Math.sin(bodyYaw / 2),
      0,
      Math.cos(bodyYaw / 2),
    );

    const headYaw =
      avatar.recordedYaw === undefined ? 0 : avatar.recordedYaw - bodyYaw;
    let headPitch = Math.max(
      -Math.PI / 2,
      Math.min(Math.PI / 2, avatar.recordedPitch ?? 0),
    );

    let modelY = 0;
    let modelPitch = 0;
    let torsoPitch = 0;
    let rightArm =
      Math.sin(avatar.phase) *
      avatar.walking *
      (state.sprinting === true ? 1.35 : 1);
    let leftArm = -rightArm;
    let rightLeg = -rightArm;
    let leftLeg = rightArm;
    let rightArmZ = 0;
    let leftArmZ = 0;

    // Standing HumanoidModel pivots, in our world-space scale.
    avatar.head.position.set(0, 1.5, 0);
    avatar.torso.position.set(0, 1.5, 0);
    avatar.rightArm.group.position.set(-0.375, 1.5, 0);
    avatar.leftArm.group.position.set(0.375, 1.5, 0);
    avatar.rightLeg.group.position.set(-0.125, 0.75, 0);
    avatar.leftLeg.group.position.set(0.125, 0.75, 0);

    if (airborne) {
      rightArm = -0.25;
      leftArm = -0.25;
      rightLeg = 0.15;
      leftLeg = -0.15;
    }

    if (sneaking) {
      // Vanilla HumanoidModel crouch: body.xRot=.5; arms +=.4; head/body/
      // arms move down 4.2/3.2 px; legs move down .2 px and 4 px toward
      // Minecraft model +Z (the model's back). The BlueMap skin front is +Z,
      // so that vanilla back offset becomes negative Z in viewer space.
      torsoPitch = 0.5;
      rightArm += 0.4;
      leftArm += 0.4;
      avatar.head.position.set(0, 1.5 - 4.2 / 16, 0);
      avatar.torso.position.set(0, 1.5 - 3.2 / 16, 0);
      avatar.rightArm.group.position.set(-0.375, 1.5 - 3.2 / 16, 0);
      avatar.leftArm.group.position.set(0.375, 1.5 - 3.2 / 16, 0);
      avatar.rightLeg.group.position.set(-0.125, 0.75 - 0.2 / 16, -4 / 16);
      avatar.leftLeg.group.position.set(0.125, 0.75 - 0.2 / 16, -4 / 16);
    }

    if (swimming) {
      modelY = 0.45;
      modelPitch = Math.PI / 2;
      torsoPitch = 0;
      headPitch = -Math.PI / 4;
      const stroke = Math.sin(avatar.phase * 0.8);
      rightArm = -1.35 + stroke * 0.45;
      leftArm = -1.35 - stroke * 0.45;
      rightLeg = stroke * 0.25;
      leftLeg = -stroke * 0.25;
    } else if (elytra) {
      modelY = 0.45;
      modelPitch = Math.PI / 2;
      torsoPitch = 0;
      headPitch = -Math.PI / 4;
      rightArm = 0.35;
      leftArm = 0.35;
      rightArmZ = -0.35;
      leftArmZ = 0.35;
      rightLeg = 0.15;
      leftLeg = 0.15;
    } else if (sleeping) {
      modelY = 0.35;
      modelPitch = Math.PI / 2;
      torsoPitch = 0;
      headPitch = 0;
      rightArm = 0;
      leftArm = 0;
      rightLeg = 0;
      leftLeg = 0;
    }

    avatar.model.position.set(0, modelY, 0);
    this.setEuler(avatar.model, modelPitch, 0, 0);
    this.setEuler(avatar.torso, torsoPitch, 0, 0);
    this.setEuler(avatar.head, headPitch, headYaw, 0);
    this.setEuler(avatar.rightArm.group, rightArm, 0, rightArmZ);
    this.setEuler(avatar.leftArm.group, leftArm, 0, leftArmZ);
    this.setEuler(avatar.rightLeg.group, rightLeg, 0, 0);
    this.setEuler(avatar.leftLeg.group, leftLeg, 0, 0);
  }

  private updateEquipment(
    avatar: PlayerAvatar,
    state: PlayerState,
    items: readonly HistoryRegistry["items"][number][],
  ): void {
    const head = this.itemVisual(state["equipment:head"], items);
    const chest = this.itemVisual(state["equipment:chest"], items);
    const legs = this.itemVisual(state["equipment:legs"], items);
    const feet = this.itemVisual(state["equipment:feet"], items);
    const main =
      this.itemVisual(state.heldItem, items) ??
      this.itemVisual(state["equipment:mainhand"], items);
    const offhand = this.itemVisual(state["equipment:offhand"], items);
    const wearables = this.wearableVisuals(state, items);
    const signature = JSON.stringify([head, chest, legs, feet, main, offhand, wearables]);
    if (signature === avatar.equipmentSignature) return;

    this.clearEquipment(avatar);
    avatar.equipmentSignature = signature;

    if (head) this.addArmor(avatar, head, "head", signature);
    if (chest) this.addArmor(avatar, chest, "chest", signature);
    if (legs) this.addArmor(avatar, legs, "legs", signature);
    if (feet) this.addArmor(avatar, feet, "feet", signature);
    if (main) this.addHeldItem(avatar, avatar.rightArm.group, main.key, "main-hand");
    if (offhand) this.addHeldItem(avatar, avatar.leftArm.group, offhand.key, "off-hand");
    for (const wearable of wearables)
      this.addWearable(
        avatar,
        wearable.item,
        wearable.slot,
        `curio-${wearable.slot}-${wearable.index}`,
        signature,
      );
  }

  private clearEquipment(avatar: PlayerAvatar): void {
    for (const part of avatar.equipmentParts) part.parent?.remove(part);
    for (const material of avatar.equipmentMaterials) material.dispose();
    for (const geometry of avatar.equipmentGeometries) geometry.dispose();
    avatar.equipmentParts.length = 0;
    avatar.equipmentMaterials.length = 0;
    avatar.equipmentGeometries.length = 0;
    avatar.equipmentSignature = "";
  }

  private addArmor(
    avatar: PlayerAvatar,
    item: ResolvedItem,
    slot: ArmorSlot,
    signature: string,
  ): void {
    const fallbacks = ARMOR_FALLBACKS[slot].map((spec) =>
      this.addEquipmentBox(
        avatar,
        this.armorParent(avatar, spec.parent),
        item.key,
        spec.size,
        spec.position,
        spec.name,
      ),
    );
    if (this.equipmentModels && item.key !== "minecraft:elytra")
      void this.upgradeArmor(avatar, item, slot, fallbacks, signature, 0);
  }

  private async upgradeArmor(
    avatar: PlayerAvatar,
    item: ResolvedItem,
    slot: ArmorSlot,
    fallbacks: Mesh[],
    signature: string,
    attempt: number,
  ): Promise<void> {
    const armor = await this.equipmentModels?.armor(item.key);
    if (
      avatar.equipmentSignature !== signature ||
      fallbacks.some((fallback) => !fallback.parent)
    )
      return;
    if (!armor) {
      if (attempt < 24)
        setTimeout(() => {
          if (
            avatar.equipmentSignature === signature &&
            fallbacks.every((fallback) => fallback.parent)
          )
            void this.upgradeArmor(avatar, item, slot, fallbacks, signature, attempt + 1);
        }, 5_000);
      return;
    }
    if (armor.kind === "custom") {
      if (!armor.parts.some((part) => part.slot === slot)) return;
      for (const fallback of fallbacks) this.removeEquipmentMesh(avatar, fallback);
      this.addCustomArmor(avatar, slot, armor);
      return;
    }

    if (armor.layer !== (slot === "legs" ? 2 : 1)) return;
    for (const fallback of fallbacks) this.removeEquipmentMesh(avatar, fallback);
    this.addTexturedArmor(avatar, item, slot, armor);
  }

  private addTexturedArmor(
    avatar: PlayerAvatar,
    item: ResolvedItem,
    slot: ArmorSlot,
    armor: Extract<LoadedArmorModel, { kind: "layers" }>,
  ): void {
    for (const [index, layer] of armor.layers.entries()) {
      const color = layer.dyeable ? (item.color ?? 0xa06540) : 0xffffff;
      const addLayer = (material: Material, extra = 0) => {
        if (layer.deformation !== undefined) {
          this.addDeformedArmorParts(
            avatar,
            slot,
            material,
            layer.deformation + extra,
            (layer.headDeformation ?? layer.deformation) + extra,
          );
        } else {
          this.addArmorParts(avatar, slot, material, index * 0.008 + extra);
        }
      };
      addLayer(this.armorMaterial(avatar, layer.texture, color));
      if (layer.overlayTexture)
        addLayer(
          this.armorMaterial(avatar, layer.overlayTexture, 0xffffff),
          0.004,
        );
    }
  }

  private addCustomArmor(
    avatar: PlayerAvatar,
    slot: ArmorSlot,
    armor: Extract<LoadedArmorModel, { kind: "custom" }>,
  ): void {
    const material = this.armorMaterial(avatar, armor.texture, 0xffffff);
    for (const part of armor.parts) {
      if (part.slot !== slot) continue;
      const geometry = new this.api.Three.BufferGeometry();
      geometry.setAttribute(
        "position",
        new this.api.Three.Float32BufferAttribute(
          new Float32Array(part.positions),
          3,
        ),
      );
      geometry.setAttribute(
        "uv",
        new this.api.Three.Float32BufferAttribute(new Float32Array(part.uvs), 2),
      );
      const mesh = new this.api.Three.Mesh(geometry, material);
      mesh.name = `custom-armor-${slot}`;
      this.decoratePlayerPart(
        mesh,
        Number(avatar.root.userData.historyPlayer),
      );
      this.armorParent(avatar, part.parent).add(mesh);
      avatar.equipmentParts.push(mesh);
      avatar.equipmentGeometries.push(geometry);
    }
  }

  private armorMaterial(
    avatar: PlayerAvatar,
    texture: Texture,
    color: number,
  ): Material {
    const material = new this.api.Three.MeshBasicMaterial({
      color,
      map: texture,
      transparent: true,
      alphaTest: 0.05,
      side: this.api.Three.DoubleSide,
      depthTest: true,
      depthWrite: true,
    });
    avatar.equipmentMaterials.push(material);
    return material;
  }

  private addArmorParts(
    avatar: PlayerAvatar,
    slot: ArmorSlot,
    material: Material,
    grow: number,
  ): void {
    for (const spec of ARMOR_PARTS[slot]) {
      const geometry = this.armorGeometry(
        spec.uv.width / 16,
        spec.uv.height / 16,
        spec.uv.depth / 16,
        spec.uv,
      );
      const mesh = new this.api.Three.Mesh(geometry, material);
      mesh.name = spec.name;
      mesh.position.set(...spec.position);
      const scale = spec.scale + grow;
      mesh.scale.set(scale, scale, scale);
      this.decoratePlayerPart(mesh, Number(avatar.root.userData.historyPlayer));
      this.armorParent(avatar, spec.parent).add(mesh);
      avatar.equipmentParts.push(mesh);
      avatar.equipmentGeometries.push(geometry);
    }
  }


  private addDeformedArmorParts(
    avatar: PlayerAvatar,
    slot: ArmorSlot,
    material: Material,
    deformation: number,
    headDeformation: number,
  ): void {
    for (const spec of ARMOR_PARTS[slot]) {
      const grow = spec.parent === "head" ? headDeformation : deformation;
      const geometry = this.armorGeometry(
        (spec.uv.width + grow * 2) / 16,
        (spec.uv.height + grow * 2) / 16,
        (spec.uv.depth + grow * 2) / 16,
        spec.uv,
      );
      const mesh = new this.api.Three.Mesh(geometry, material);
      mesh.name = spec.name;
      mesh.position.set(...spec.position);
      this.decoratePlayerPart(mesh, Number(avatar.root.userData.historyPlayer));
      this.armorParent(avatar, spec.parent).add(mesh);
      avatar.equipmentParts.push(mesh);
      avatar.equipmentGeometries.push(geometry);
    }
  }

  private armorParent(avatar: PlayerAvatar, parent: ArmorParent): Object3D {
    if (parent === "head") return avatar.head;
    if (parent === "torso") return avatar.torso;
    if (parent === "rightArm") return avatar.rightArm.group;
    if (parent === "leftArm") return avatar.leftArm.group;
    if (parent === "rightLeg") return avatar.rightLeg.group;
    return avatar.leftLeg.group;
  }

  private addEquipmentBox(
    avatar: PlayerAvatar,
    parent: Object3D,
    item: string,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    name: string,
    pitch = 0,
  ): Mesh {
    const T = this.api.Three;
    const geometry = new T.BoxGeometry(size[0], size[1], size[2]);
    const material = new T.MeshBasicMaterial({
      color: this.equipmentColor(item),
      transparent: false,
    });
    const mesh = new T.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    this.setEuler(mesh, pitch, 0, 0);
    this.decoratePlayerPart(mesh, Number(avatar.root.userData.historyPlayer));
    parent.add(mesh);
    avatar.equipmentParts.push(mesh);
    avatar.equipmentMaterials.push(material);
    avatar.equipmentGeometries.push(geometry);
    return mesh;
  }

  private addWearable(
    avatar: PlayerAvatar,
    item: ResolvedItem,
    slot: string,
    name: string,
    signature: string,
  ): void {
    if (!this.equipmentModels) return;
    void this.upgradeWearable(avatar, item, slot, name, signature, 0);
  }

  private async upgradeWearable(
    avatar: PlayerAvatar,
    item: ResolvedItem,
    slot: string,
    name: string,
    signature: string,
    attempt: number,
  ): Promise<void> {
    const transform = await this.equipmentModels?.wearable(slot, item.key);
    const model = transform ? await this.equipmentModels?.build(item.key) : null;
    if (avatar.equipmentSignature !== signature) {
      if (model) this.disposeBuiltEquipmentModel(model);
      return;
    }
    if (!transform || !model) {
      if (attempt < 24)
        setTimeout(() => {
          if (avatar.equipmentSignature === signature)
            void this.upgradeWearable(avatar, item, slot, name, signature, attempt + 1);
        }, 5_000);
      return;
    }

    model.root.name = name;
    model.root.position.set(...transform.position);
    model.root.scale.set(transform.scale, transform.scale, transform.scale);
    this.setEuler(
      model.root,
      (transform.rotationDegrees[0] * Math.PI) / 180,
      (transform.rotationDegrees[1] * Math.PI) / 180,
      (transform.rotationDegrees[2] * Math.PI) / 180,
    );
    this.decorateEquipmentModel(avatar, model);
    this.armorParent(avatar, transform.parent).add(model.root);
    avatar.equipmentParts.push(model.root, ...model.parts);
    avatar.equipmentMaterials.push(...model.materials);
    avatar.equipmentGeometries.push(...model.geometries);
  }

  private addHeldItem(
    avatar: PlayerAvatar,
    parent: Object3D,
    item: string,
    name: string,
  ): void {
    let size: readonly [number, number, number] = [0.18, 0.32, 0.08];
    if (item.includes("shield")) size = [0.42, 0.5, 0.08];
    else if (item.endsWith("_sword")) size = [0.08, 0.68, 0.05];
    else if (/(pickaxe|_axe|shovel|_hoe)$/.test(item)) size = [0.1, 0.58, 0.1];
    else if (item.includes("bow")) size = [0.08, 0.55, 0.12];
    const fallback = this.addEquipmentBox(
      avatar,
      parent,
      item,
      size,
      [0, -0.82, 0.08],
      name,
      -0.35,
    );
    if (this.equipmentModels) {
      void this.upgradeHeldItem(
        avatar,
        parent,
        item,
        name,
        fallback,
        avatar.equipmentSignature,
        0,
      );
    }
  }

  private async upgradeHeldItem(
    avatar: PlayerAvatar,
    parent: Object3D,
    item: string,
    name: string,
    fallback: Mesh,
    signature: string,
    attempt: number,
  ): Promise<void> {
    const model = await this.equipmentModels?.build(item);
    if (avatar.equipmentSignature !== signature || !fallback.parent) {
      if (model) this.disposeBuiltEquipmentModel(model);
      return;
    }
    if (!model) {
      if (attempt < 8) {
        setTimeout(() => {
          if (avatar.equipmentSignature === signature && fallback.parent)
            void this.upgradeHeldItem(
              avatar,
              parent,
              item,
              name,
              fallback,
              signature,
              attempt + 1,
            );
        }, 5_000);
      }
      return;
    }

    this.removeEquipmentMesh(avatar, fallback);

    model.root.name = name;
    model.root.position.set(0, -0.78, 0.08);
    model.root.scale.set(0.72, 0.72, 0.72);
    this.setEuler(model.root, -0.35, 0, name === "off-hand" ? 0.16 : -0.16);
    this.decorateEquipmentModel(avatar, model);
    parent.add(model.root);
    avatar.equipmentParts.push(model.root, ...model.parts);
    avatar.equipmentMaterials.push(...model.materials);
    avatar.equipmentGeometries.push(...model.geometries);
  }

  private decorateEquipmentModel(
    avatar: PlayerAvatar,
    model: BuiltEquipmentModel,
  ): void {
    const player = Number(avatar.root.userData.historyPlayer);
    for (const part of [model.root, ...model.parts]) {
      this.decoratePlayerPart(part, player);
      part.userData.historyTooltip = avatar.root.userData.historyTooltip;
      part.userData.historyTime = avatar.root.userData.historyTime;
      part.userData.historyPoint = avatar.root.userData.historyPoint;
    }
  }

  private disposeBuiltEquipmentModel(model: BuiltEquipmentModel): void {
    for (const material of model.materials) material.dispose();
    for (const geometry of model.geometries) geometry.dispose();
  }

  private removeEquipmentMesh(avatar: PlayerAvatar, mesh: Mesh): void {
    mesh.parent?.remove(mesh);
    avatar.equipmentParts = avatar.equipmentParts.filter((part) => part !== mesh);
    avatar.equipmentMaterials = avatar.equipmentMaterials.filter(
      (material) => material !== mesh.material,
    );
    avatar.equipmentGeometries = avatar.equipmentGeometries.filter(
      (geometry) => geometry !== mesh.geometry,
    );
    mesh.material.dispose();
    mesh.geometry.dispose();
  }

  private wearableVisuals(
    state: PlayerState,
    items: readonly HistoryRegistry["items"][number][],
  ): WearableVisual[] {
    const result: WearableVisual[] = [];
    for (const [key, value] of Object.entries(state).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (!key.startsWith("curio:")) continue;
      const match = /^curio:(.+):(\d+)$/.exec(key);
      if (!match?.[1] || match[2] === undefined) continue;
      const item = this.itemVisual(value, items);
      if (!item) continue;
      result.push({ slot: match[1], index: Number(match[2]), item });
    }
    return result;
  }

  private itemVisual(
    value: unknown,
    items: readonly HistoryRegistry["items"][number][],
  ): ResolvedItem | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const data = value as { item?: unknown; color?: unknown };
    if (typeof data.item !== "number" || data.item <= 0) return undefined;
    const key = items.find((entry) => entry.id === data.item)?.key;
    if (!key) return undefined;
    const color =
      typeof data.color === "number" &&
      Number.isInteger(data.color) &&
      data.color >= 0 &&
      data.color <= 0xffffff
        ? data.color
        : undefined;
    return { key, ...(color !== undefined ? { color } : {}) };
  }

  private equipmentColor(item: string): number {
    if (item.includes("netherite")) return 0x36343f;
    if (item.includes("diamond")) return 0x55d8dc;
    if (item.includes("gold")) return 0xf2c94c;
    if (item.includes("iron") || item.includes("chain")) return 0xc7c7c7;
    if (item.includes("leather")) return 0x8b5a2b;
    if (item.includes("turtle")) return 0x4f9a57;
    if (item.includes("shield")) return 0x8b6b45;
    if (item.includes("torch")) return 0xf2a93b;
    return 0x8c8c8c;
  }

  private setEuler(object: Object3D, x: number, y: number, z: number): void {
    const sx = Math.sin(x / 2);
    const cx = Math.cos(x / 2);
    const sy = Math.sin(y / 2);
    const cy = Math.cos(y / 2);
    const sz = Math.sin(z / 2);
    const cz = Math.cos(z / 2);
    object.quaternion.set(
      sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz + sx * sy * cz,
      cx * cy * cz - sx * sy * sz,
    );
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

    const geometry = new this.api.Three.BoxGeometry(width, height, depth);
    this.setBoxUvs(geometry, skin, 64);
    this.geometries.set(key, geometry);
    return geometry;
  }

  private armorGeometry(
    width: number,
    height: number,
    depth: number,
    skin: SkinBox,
  ): Geometry {
    const geometry = new this.api.Three.BoxGeometry(width, height, depth);
    this.setBoxUvs(geometry, skin, 32);
    return geometry;
  }

  private setBoxUvs(
    geometry: Geometry,
    skin: SkinBox,
    textureHeight: number,
  ): void {
    const uv = (
      geometry as Geometry & {
        attributes?: {
          uv?: {
            set(values: Float32Array): void;
            needsUpdate: boolean;
          };
        };
      }
    ).attributes?.uv;
    if (!uv) {
      throw new Error("BlueMap Three.js BoxGeometry has no UV attribute");
    }

    const { u, v, width: pixelWidth, height: pixelHeight, depth: pixelDepth } = skin;
    const rect = (x1: number, y1: number, x2: number, y2: number) => [
      [x1 / 64, 1 - y2 / textureHeight],
      [x2 / 64, 1 - y2 / textureHeight],
      [x2 / 64, 1 - y1 / textureHeight],
      [x1 / 64, 1 - y1 / textureHeight],
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
  }

}
