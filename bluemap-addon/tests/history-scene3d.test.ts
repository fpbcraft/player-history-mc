import assert from "node:assert/strict";
import { test } from "vitest";
import { HistoryScene3D } from "../src/history-scene3d.js";
import type {
  BlueMapRuntime,
  Geometry,
  Material,
  Matrix4,
  Object3D,
  Position3,
  Quaternion3,
  Texture,
} from "../src/bluemap-types.js";

class P implements Position3 {
  x = 0;
  y = 0;
  z = 0;
  set(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}
class Q implements Quaternion3 {
  values: [number, number, number, number] = [0, 0, 0, 1];
  set(x: number, y: number, z: number, w: number): Quaternion3 {
    this.values = [x, y, z, w];
    return this;
  }
}
class O implements Object3D {
  position = new P();
  scale = new P();
  quaternion = new Q();
  visible = true;
  name = "";
  userData: Record<string, unknown> = {};
  parent?: { remove(child: Object3D): void };
  children: Object3D[] = [];
  add(...children: Object3D[]): void {
    for (const child of children) {
      this.children.push(child);
      child.parent = this;
    }
  }
  remove(child: Object3D): void {
    this.children = this.children.filter((candidate) => candidate !== child);
  }
  clone(): Object3D {
    return new O();
  }
}
class G implements Geometry {
  attributes = new Map<string, unknown>();
  index?: unknown;
  disposed = false;
  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, value);
  }
  setIndex(value: unknown): void {
    this.index = value;
  }
  dispose(): void {
    this.disposed = true;
  }
}
class Box extends G {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly depth: number,
  ) {
    super();
    const uv = {
      values: new Float32Array(48),
      size: 2,
      needsUpdate: false,
      set(values: Float32Array) {
        this.values = values;
      },
    };
    const position = {
      values: new Float32Array(72),
      size: 3,
    };
    this.attributes.set("uv", uv);
    this.attributes.set("position", position);
    Object.assign(this.attributes, { uv, position });
  }
}

class M implements Material {
  map?: Texture | null;
  needsUpdate?: boolean;
  disposed = false;
  constructor(readonly options: Record<string, unknown>) {}
  dispose(): void {
    this.disposed = true;
  }
}
class T implements Texture {
  flipY = true;
  disposed = false;
  dispose(): void {
    this.disposed = true;
  }
}
class MX implements Matrix4 {
  value: [number, number, number] = [0, 0, 0];
  makeTranslation(x: number, y: number, z: number): Matrix4 {
    this.value = [x, y, z];
    return this;
  }
}
class Mesh extends O {
  renderOrder = 0;
  constructor(
    readonly geometry: Geometry,
    readonly material: Material,
  ) {
    super();
  }
}
class Line extends O {
  constructor(
    readonly geometry: Geometry,
    readonly material: Material,
  ) {
    super();
  }
}
class Instanced extends O {
  instanceMatrix = { needsUpdate: false };
  matrices: Matrix4[] = [];
  constructor(
    readonly geometry: Geometry,
    readonly material: Material,
    readonly count: number,
  ) {
    super();
  }
  setMatrixAt(index: number, matrix: Matrix4): void {
    this.matrices[index] = matrix;
  }
}
const loaded: string[] = [];
class Loader {
  load(url: string, onLoad?: (texture: Texture) => void): Texture {
    loaded.push(url);
    const texture = new T();
    onLoad?.(texture);
    return texture;
  }
}

const runtime = (): BlueMapRuntime =>
  ({
    Three: {
      Group: O,
      BufferGeometry: G,
      BoxGeometry: Box,
      Float32BufferAttribute: class {
        constructor(
          readonly values: number[] | Float32Array,
          readonly size: number,
        ) {}
      },
      MeshBasicMaterial: M,
      LineBasicMaterial: M,
      TextureLoader: Loader,
      Mesh,
      Line,
      SphereGeometry: G,
      InstancedMesh: Instanced,
      Matrix4: MX,
      DoubleSide: 2,
      FrontSide: 1,
      NearestFilter: 1,
    },
  }) as unknown as BlueMapRuntime;

test("3D history scene creates skinned articulated players", () => {
  loaded.length = 0;
  const scene = new HistoryScene3D(runtime(), "https://map.example/player-history/skins/");
  scene.setPlayers(
    [{ player: 1, time: 1000, world: 0, x: 32, y: 64 * 32, z: 64, flags: 0 }],
    new Map([[1, "Alex"]]),
    [{ id: 1, uuid: "01234567-89ab-cdef-0123-456789abcdef", name: "Alex" }],
  );

  assert.deepEqual(loaded, [
    "https://map.example/player-history/skins/01234567-89ab-cdef-0123-456789abcdef.png",
  ]);
  const playersRoot = scene.root.children?.[2] as O;
  assert.equal(playersRoot.children.length, 1);
  const avatar = playersRoot.children[0] as O;
  assert.equal(avatar.position.x, 1);
  assert.equal(avatar.position.y, 64);
  assert.equal(avatar.position.z, 2);
  assert.equal(avatar.userData.historyKind, "player");

  const model = avatar.children[0] as O;
  const headGroup = model.children[0] as O;
  const headMesh = headGroup.children[0] as Mesh;
  const headGeometry = headMesh.geometry as G;
  const uv = headGeometry.attributes.get("uv") as
    | { values: Float32Array; size: number }
    | undefined;
  const position = headGeometry.attributes.get("position") as
    | { values: Float32Array; size: number }
    | undefined;
  assert.ok(uv);
  assert.ok(position);
  assert.equal(uv.values.length, 48);
  assert.equal(position.values.length, 72);
  assert.deepEqual(
    Array.from(uv.values.slice(0, 8)),
    [0.25, 0.875, 0.375, 0.875, 0.25, 0.75, 0.375, 0.75],
  );
  assert.equal((headMesh.material as M).options.transparent, false);
  const hatMesh = headGroup.children[1] as Mesh;
  assert.equal((hatMesh.material as M).options.transparent, true);

  scene.setPlayerVitals(
    1,
    {
      yaw: 90,
      pitch: 20,
      sneaking: true,
      heldItem: { item: 1, count: 1 },
      "equipment:head": { item: 2, count: 1 },
    },
    [
      { id: 1, key: "minecraft:diamond_sword" },
      { id: 2, key: "minecraft:diamond_helmet" },
    ],
  );
  assert.ok(Math.abs(avatar.quaternion.values[1] + Math.SQRT1_2) < 0.001);
  assert.equal(model.position.y, 0);
  assert.ok(Math.abs(headGroup.position.y - 1.2375) < 0.0001);
  const torso = model.children[1] as O;
  assert.ok(Math.abs(torso.position.y - 1.3) < 0.0001);
  assert.ok(Math.abs(torso.quaternion.values[0] - Math.sin(0.25)) < 0.0001);
  assert.equal(headGroup.children.length, 3, "helmet is attached to the head");
  const rightArm = model.children[2] as O;
  assert.ok(Math.abs(rightArm.position.y - 1.3) < 0.0001);
  assert.equal(rightArm.children.length, 3, "held item is attached to the arm");
  const rightLeg = model.children[4] as O;
  assert.ok(Math.abs(rightLeg.position.y - 0.7375) < 0.0001);
  assert.equal(rightLeg.position.z, -0.25);
});

test("3D equipment slots render nonstandard item ids without filename heuristics", () => {
  const scene = new HistoryScene3D(runtime(), "https://map.example/player-history/skins/");
  scene.setPlayers(
    [{ player: 1, time: 1000, world: 0, x: 0, y: 64 * 32, z: 0, flags: 0 }],
    new Map([[1, "Alex"]]),
    [{ id: 1, uuid: "", name: "Alex" }],
  );
  const playersRoot = scene.root.children?.[2] as O;
  const avatar = playersRoot.children[0] as O;
  const model = avatar.children[0] as O;
  const torso = model.children[1] as O;

  scene.setPlayerVitals(
    1,
    { "equipment:chest": { item: 1, count: 1 } },
    [{ id: 1, key: "paladins:netherite_prior_robe_chest" }],
  );

  assert.equal(
    torso.children.length,
    3,
    "an occupied chest equipment slot gets an equipment representation",
  );
});

test("non-armor head Equipables use wearable mappings instead of the gray armor fallback", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/wearables.json")) {
      return {
        ok: true,
        json: async () => ({
          format: 1,
          slots: {},
          items: {
            "create:goggles": {
              parent: "head",
              position: [0, 0.25, 0],
              rotationDegrees: [0, 0, 180],
              scale: 0.625,
            },
          },
        }),
      } as Response;
    }
    if (url.pathname.endsWith("/models/create/goggles.json")) {
      return {
        ok: true,
        json: async () => ({
          format: 1,
          item: "create:goggles",
          groups: [
            {
              tint: 0xffffff,
              positions: [
                -0.2, -0.1, 0, 0.2, -0.1, 0, 0.2, 0.1, 0,
                -0.2, -0.1, 0, 0.2, 0.1, 0, -0.2, 0.1, 0,
              ],
              uvs: [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
            },
          ],
        }),
      } as Response;
    }
    return { ok: false, json: async () => ({}) } as Response;
  }) as typeof fetch;

  try {
    const scene = new HistoryScene3D(
      runtime(),
      "https://map.example/player-history/skins/",
      "https://map.example/player-history/equipment/",
    );
    scene.setPlayers(
      [{ player: 1, time: 1000, world: 0, x: 0, y: 64 * 32, z: 0, flags: 0 }],
      new Map([[1, "Alex"]]),
      [{ id: 1, uuid: "", name: "Alex" }],
    );
    scene.setPlayerVitals(
      1,
      { "equipment:head": { item: 1, count: 1 } },
      [{ id: 1, key: "create:goggles" }],
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const playersRoot = scene.root.children?.[2] as O;
    const avatar = playersRoot.children[0] as O;
    const head = (avatar.children[0] as O).children[0] as O;
    assert.ok(
      head.children.some((child) => child.name === "wearable-head"),
      "Create goggles replace the generic helmet fallback with the wearable item model",
    );
    assert.equal(
      head.children.some((child) => child.name === "helmet"),
      false,
      "the gray armor fallback is removed after the wearable model resolves",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("3D player head uses full vanilla look pitch around the neck pivot", () => {
  const scene = new HistoryScene3D(runtime(), "https://map.example/player-history/skins/");
  scene.setPlayers(
    [{ player: 1, time: 1000, world: 0, x: 0, y: 64 * 32, z: 0, flags: 0 }],
    new Map([[1, "Alex"]]),
    [{ id: 1, uuid: "", name: "Alex" }],
  );
  const playersRoot = scene.root.children?.[2] as O;
  const avatar = playersRoot.children[0] as O;
  const model = avatar.children[0] as O;
  const head = model.children[0] as O;
  const headMesh = head.children[0] as O;

  assert.equal(head.position.y, 1.5);
  assert.equal(headMesh.position.y, 0.25);

  scene.setPlayerVitals(1, { pitch: 90 });
  assert.ok(Math.abs(head.quaternion.values[0] - Math.SQRT1_2) < 0.001);
  assert.ok(Math.abs(head.quaternion.values[3] - Math.SQRT1_2) < 0.001);

  scene.setPlayerVitals(1, { pitch: -90 });
  assert.ok(Math.abs(head.quaternion.values[0] + Math.SQRT1_2) < 0.001);
  assert.ok(Math.abs(head.quaternion.values[3] - Math.SQRT1_2) < 0.001);
});

test("3D player separates body yaw from head yaw when available", () => {
  const scene = new HistoryScene3D(runtime(), "https://map.example/player-history/skins/");
  scene.setPlayers(
    [{ player: 1, time: 1000, world: 0, x: 0, y: 64 * 32, z: 0, flags: 0 }],
    new Map([[1, "Alex"]]),
    [{ id: 1, uuid: "", name: "Alex" }],
  );
  const playersRoot = scene.root.children?.[2] as O;
  const avatar = playersRoot.children[0] as O;
  const head = (avatar.children[0] as O).children[0] as O;

  scene.setPlayerVitals(1, { yaw: 90, headYaw: 90, bodyYaw: 45, pitch: 0 });
  const sin22_5 = Math.sin(Math.PI / 8);
  const cos22_5 = Math.cos(Math.PI / 8);
  assert.ok(Math.abs(avatar.quaternion.values[1] + sin22_5) < 0.001);
  assert.ok(Math.abs(avatar.quaternion.values[3] - cos22_5) < 0.001);
  assert.ok(Math.abs(head.quaternion.values[1] + sin22_5) < 0.001);
  assert.ok(Math.abs(head.quaternion.values[3] - cos22_5) < 0.001);
});

test("3D player pose switches to horizontal swimming and elytra states", () => {
  const scene = new HistoryScene3D(runtime(), "https://map.example/player-history/skins/");
  scene.setPlayers(
    [{ player: 1, time: 1000, world: 0, x: 0, y: 64 * 32, z: 0, flags: 0 }],
    new Map([[1, "Alex"]]),
    [{ id: 1, uuid: "", name: "Alex" }],
  );
  const playersRoot = scene.root.children?.[2] as O;
  const avatar = playersRoot.children[0] as O;
  const model = avatar.children[0] as O;

  scene.setPlayerVitals(1, { swimming: true });
  assert.ok(Math.abs(model.quaternion.values[0] - Math.SQRT1_2) < 0.001);
  assert.equal(model.position.y, 0.45);

  scene.setPlayerVitals(1, { elytra: true });
  assert.ok(Math.abs(model.quaternion.values[0] - Math.SQRT1_2) < 0.001);
});

test("3D trails are depth tested and event anchors are instanced", () => {
  const scene = new HistoryScene3D(runtime(), "https://map.example/player-history/skins/");
  const segment = [
    { player: 1, time: 1000, world: 0, x: 0, y: 64 * 32, z: 0, flags: 0 },
    { player: 1, time: 1100, world: 0, x: 32, y: 64 * 32, z: 0, flags: 0 },
  ];
  scene.setTrails([segment], new Map([[1, "Alex"]]));
  const trailsRoot = scene.root.children?.[0] as O;
  assert.equal(trailsRoot.children.length, 1);
  const line = trailsRoot.children[0] as Line;
  assert.equal((line.material as M).options.depthTest, true);
  assert.equal(line.userData.historyKind, "trail");

  scene.setEvents(
    [
      { point: segment[0], type: "DEATH", payload: "{}" },
      { point: segment[1], type: "DEATH", payload: "{}" },
    ],
    new Map([[1, "Alex"]]),
    {},
  );
  const eventsRoot = scene.root.children?.[1] as O;
  assert.equal(eventsRoot.children.length, 1);
  const anchors = eventsRoot.children[0] as Instanced;
  assert.equal(anchors.count, 2);
  assert.equal(anchors.userData.historyKind, "events");
  assert.equal(anchors.matrices.length, 2);
});


test("3D player parts consume clicks and expose a follow target", () => {
  let clicked: number | undefined;
  const scene = new HistoryScene3D(
    runtime(),
    "https://map.example/player-history/skins/",
    undefined,
    (player) => {
      clicked = player;
    },
  );
  scene.setPlayers(
    [{ player: 1, time: 1000, world: 0, x: 32, y: 64 * 32, z: 64, flags: 0 }],
    new Map([[1, "Alex"]]),
    [{ id: 1, uuid: "", name: "Alex" }],
  );

  const playersRoot = scene.root.children?.[2] as O;
  const avatar = playersRoot.children[0] as O;
  const head = (avatar.children[0] as O).children[0] as O;
  const headMesh = head.children[0] as Mesh;

  assert.equal(scene.playerTarget(1), avatar);
  assert.equal(headMesh.onClick?.({}), true);
  assert.equal(clicked, 1);
});
