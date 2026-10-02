import assert from "node:assert/strict";
import { test } from "vitest";
import { EquipmentModelLoader } from "../src/equipment-model-loader.js";
import type {
  BlueMapRuntime,
  Geometry,
  Material,
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
  set(): Quaternion3 {
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
  disposed = false;
  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, value);
  }
  dispose(): void {
    this.disposed = true;
  }
}

class M implements Material {
  map?: Texture | null;
  disposed = false;
  constructor(readonly options: Record<string, unknown>) {
    this.map = options.map as Texture | undefined;
  }
  dispose(): void {
    this.disposed = true;
  }
}

class T implements Texture {
  flipY = true;
  magFilter?: unknown;
  minFilter?: unknown;
  generateMipmaps?: boolean;
  needsUpdate?: boolean;
  disposed = false;
  dispose(): void {
    this.disposed = true;
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

const textureUrls: string[] = [];
class Loader {
  load(
    url: string,
    onLoad?: (texture: Texture) => void,
  ): Texture {
    textureUrls.push(url);
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
      Float32BufferAttribute: class {
        constructor(
          readonly values: number[] | Float32Array,
          readonly size: number,
        ) {}
      },
      MeshBasicMaterial: M,
      TextureLoader: Loader,
      Mesh,
      DoubleSide: 2,
      NearestFilter: 1,
    },
  }) as unknown as BlueMapRuntime;

const model = {
  format: 1,
  item: "minecraft:diamond_sword",
  fingerprint: "abc123",
  groups: [
    {
      texture: "textures/minecraft/item/diamond_sword.png",
      tint: 0xffffff,
      positions: [
        -0.2, -0.5, 0, 0.2, -0.5, 0, 0.2, 0.5, 0,
        -0.2, -0.5, 0, 0.2, 0.5, 0, -0.2, 0.5, 0,
      ],
      uvs: [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
    },
  ],
};

test("equipment loader builds textured geometry from a published item descriptor", async () => {
  textureUrls.length = 0;
  const requested: string[] = [];
  const loader = new EquipmentModelLoader(
    runtime(),
    "https://map.example/player-history/equipment/",
    async (input) => {
      requested.push(String(input));
      return { ok: true, json: async () => model };
    },
  );

  const built = await loader.build("minecraft:diamond_sword");
  assert.ok(built);
  assert.equal(built.parts.length, 1);
  assert.equal(built.materials.length, 1);
  assert.equal(built.geometries.length, 1);
  assert.deepEqual(requested, [
    "https://map.example/player-history/equipment/models/minecraft/diamond_sword.json",
  ]);
  assert.deepEqual(textureUrls, [
    "https://map.example/player-history/equipment/textures/minecraft/item/diamond_sword.png",
  ]);

  const geometry = built.parts[0]?.geometry as G;
  const position = geometry.attributes.get("position") as
    | { values: Float32Array; size: number }
    | undefined;
  const uv = geometry.attributes.get("uv") as
    | { values: Float32Array; size: number }
    | undefined;
  assert.equal(position?.values.length, 18);
  assert.equal(position?.size, 3);
  assert.equal(uv?.values.length, 12);
  assert.equal(uv?.size, 2);
  assert.equal((built.materials[0] as M).options.color, 0xffffff);
  assert.ok((built.materials[0] as M).options.map);
});

test("equipment loader rejects malformed descriptors and retries missing models", async () => {
  let requests = 0;
  const loader = new EquipmentModelLoader(
    runtime(),
    "https://map.example/player-history/equipment/",
    async () => {
      requests++;
      if (requests === 1) return { ok: false, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({
          ...model,
          groups: [{ ...model.groups[0], positions: [1, 2, 3] }],
        }),
      };
    },
  );

  assert.equal(await loader.build("minecraft:diamond_sword"), null);
  assert.equal(await loader.build("minecraft:diamond_sword"), null);
  assert.equal(requests, 2);
});


test("equipment loader loads armor base and overlay textures", async () => {
  textureUrls.length = 0;
  const requested: string[] = [];
  const loader = new EquipmentModelLoader(
    runtime(),
    "https://map.example/player-history/equipment/",
    async (input) => {
      requested.push(String(input));
      return {
        ok: true,
        json: async () => ({
          format: 1,
          item: "minecraft:leather_helmet",
          layer: 1,
          texture: "textures/minecraft/models/armor/leather_layer_1.png",
          overlayTexture:
            "textures/minecraft/models/armor/leather_layer_1_overlay.png",
        }),
      };
    },
  );

  const armor = await loader.armor("minecraft:leather_helmet");
  assert.ok(armor);
  assert.equal(armor.kind, "layer");
  if (armor.kind !== "layer") throw new Error("expected layered armor");
  assert.equal(armor.layer, 1);
  assert.equal(armor.layers.length, 2);
  assert.equal(armor.layers[0]?.dyeable, true);
  assert.equal(armor.layers[1]?.dyeable, false);
  assert.deepEqual(requested, [
    "https://map.example/player-history/equipment/armor/minecraft/leather_helmet.json",
  ]);
  assert.deepEqual(textureUrls, [
    "https://map.example/player-history/equipment/textures/minecraft/models/armor/leather_layer_1.png",
    "https://map.example/player-history/equipment/textures/minecraft/models/armor/leather_layer_1_overlay.png",
  ]);
});

test("equipment loader loads declared armor material layers", async () => {
  textureUrls.length = 0;
  const loader = new EquipmentModelLoader(
    runtime(),
    "https://map.example/player-history/equipment/",
    async () => ({
      ok: true,
      json: async () => ({
        format: 1,
        item: "example:layered_chest",
        kind: "layer",
        layer: 1,
        layers: [
          {
            texture: "textures/example/models/armor/layered_layer_1.png",
            dyeable: true,
          },
          {
            texture: "textures/example/models/armor/layered_layer_1_overlay.png",
            dyeable: false,
          },
        ],
      }),
    }),
  );

  const armor = await loader.armor("example:layered_chest");
  assert.ok(armor);
  assert.equal(armor.kind, "layer");
  if (armor.kind !== "layer") throw new Error("expected layered armor");
  assert.equal(armor.layers.length, 2);
  assert.equal(armor.layers[0]?.dyeable, true);
  assert.equal(armor.layers[1]?.dyeable, false);
});

test("equipment loader rejects unsafe armor texture paths", async () => {
  const loader = new EquipmentModelLoader(
    runtime(),
    "https://map.example/player-history/equipment/",
    async () => ({
      ok: true,
      json: async () => ({
        format: 1,
        item: "minecraft:diamond_leggings",
        layer: 2,
        texture: "../secret.png",
      }),
    }),
  );

  assert.equal(await loader.armor("minecraft:diamond_leggings"), null);
});


test("equipment loader loads generic custom armor geometry", async () => {
  textureUrls.length = 0;
  const loader = new EquipmentModelLoader(
    runtime(),
    "https://map.example/player-history/equipment/",
    async () => ({
      ok: true,
      json: async () => ({
        format: 1,
        item: "example:mage_robe_chest",
        kind: "custom",
        texture: "textures/example/armor/mage_robe.png",
        parts: [
          {
            parent: "torso",
            slot: "chest",
            positions: [
              0, 0, 0, 1, 0, 0, 1, 1, 0,
              0, 0, 0, 1, 1, 0, 0, 1, 0,
            ],
            uvs: [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
          },
        ],
      }),
    }),
  );

  const armor = await loader.armor("example:mage_robe_chest");
  assert.ok(armor);
  assert.equal(armor.kind, "custom");
  assert.equal(armor.parts.length, 1);
  assert.equal(armor.parts[0]?.parent, "torso");
  assert.equal(armor.parts[0]?.slot, "chest");
  assert.deepEqual(textureUrls, [
    "https://map.example/player-history/equipment/textures/example/armor/mage_robe.png",
  ]);
});

test("equipment loader rejects invalid custom armor body parts", async () => {
  const loader = new EquipmentModelLoader(
    runtime(),
    "https://map.example/player-history/equipment/",
    async () => ({
      ok: true,
      json: async () => ({
        format: 1,
        item: "example:mage_robe_chest",
        kind: "custom",
        texture: "textures/example/armor/mage_robe.png",
        parts: [
          {
            parent: "cape",
            slot: "chest",
            positions: [
              0, 0, 0, 1, 0, 0, 1, 1, 0,
              0, 0, 0, 1, 1, 0, 0, 1, 0,
            ],
            uvs: [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
          },
        ],
      }),
    }),
  );

  assert.equal(await loader.armor("example:mage_robe_chest"), null);
});
