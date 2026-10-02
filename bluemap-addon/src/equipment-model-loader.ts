import type {
  BlueMapRuntime,
  Geometry,
  Material,
  Object3D,
  Texture,
} from "./bluemap-types.js";

interface PublishedGroup {
  texture?: string | null;
  tint: number;
  positions: number[];
  uvs: number[];
}

interface PublishedItemModel {
  format: 1;
  item: string;
  fingerprint?: string;
  groups: PublishedGroup[];
}

interface PublishedArmorTextureLayer {
  texture: string;
  dyeable: boolean;
}

interface PublishedLayerArmorModel {
  format: 1;
  item: string;
  kind: "layer";
  layer: 1 | 2;
  layers: PublishedArmorTextureLayer[];
}

type ArmorParent =
  | "head"
  | "torso"
  | "rightArm"
  | "leftArm"
  | "rightLeg"
  | "leftLeg";
type ArmorSlot = "head" | "chest" | "legs" | "feet";

interface PublishedCustomArmorPart {
  parent: ArmorParent;
  slot: ArmorSlot;
  positions: number[];
  uvs: number[];
}

interface PublishedCustomArmorModel {
  format: 1;
  item: string;
  kind: "custom";
  texture: string;
  parts: PublishedCustomArmorPart[];
}

type PublishedArmorModel = PublishedLayerArmorModel | PublishedCustomArmorModel;

export interface BuiltEquipmentModel {
  root: Object3D;
  parts: Object3D[];
  geometries: Geometry[];
  materials: Material[];
}

export type LoadedArmorModel =
  | {
      kind: "layer";
      layer: 1 | 2;
      layers: { texture: Texture; dyeable: boolean }[];
    }
  | {
      kind: "custom";
      texture: Texture;
      parts: PublishedCustomArmorPart[];
    };

type JsonResponse = {
  ok: boolean;
  json(): Promise<unknown>;
};

type ModelFetcher = (input: RequestInfo | URL) => Promise<JsonResponse>;

const resourceId = (value: string): { namespace: string; path: string } | null => {
  const match = /^([a-z0-9_.-]+):([a-z0-9_./-]+)$/.exec(value);
  const namespace = match?.[1];
  const path = match?.[2];
  return namespace && path ? { namespace, path } : null;
};

const isNumberArray = (value: unknown, multiple: number): value is number[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length % multiple === 0 &&
  value.every(Number.isFinite);

const safeRelativePath = (value: unknown): value is string =>
  typeof value === "string" &&
  !value.startsWith("/") &&
  !value.includes("..");

const armorParents = new Set([
  "head",
  "torso",
  "rightArm",
  "leftArm",
  "rightLeg",
  "leftLeg",
]);
const armorSlots = new Set(["head", "chest", "legs", "feet"]);

const parseArmorModel = (value: unknown, item: string): PublishedArmorModel | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const model = value as Record<string, unknown>;
  if (model.format !== 1 || model.item !== item) return null;

  if (model.kind === "custom") {
    if (!safeRelativePath(model.texture)) return null;
    if (!Array.isArray(model.parts)) return null;
    const parts: PublishedCustomArmorPart[] = [];
    for (const raw of model.parts) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const part = raw as Record<string, unknown>;
      if (
        typeof part.parent !== "string" ||
        !armorParents.has(part.parent) ||
        typeof part.slot !== "string" ||
        !armorSlots.has(part.slot) ||
        !isNumberArray(part.positions, 18) ||
        !isNumberArray(part.uvs, 12) ||
        part.positions.length / 3 !== part.uvs.length / 2
      )
        return null;
      parts.push({
        parent: part.parent as ArmorParent,
        slot: part.slot as ArmorSlot,
        positions: part.positions,
        uvs: part.uvs,
      });
    }
    return {
      format: 1,
      item,
      kind: "custom",
      texture: model.texture,
      parts,
    };
  }

  if (model.layer !== 1 && model.layer !== 2) return null;

  const layers: PublishedArmorTextureLayer[] = [];
  if (Array.isArray(model.layers)) {
    for (const raw of model.layers) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const layer = raw as Record<string, unknown>;
      if (
        !safeRelativePath(layer.texture) ||
        typeof layer.dyeable !== "boolean"
      )
        return null;
      layers.push({
        texture: layer.texture,
        dyeable: layer.dyeable,
      });
    }
  } else {
    // Backward compatibility with descriptors emitted by #42.
    if (!safeRelativePath(model.texture)) return null;
    if (
      model.overlayTexture != null &&
      !safeRelativePath(model.overlayTexture)
    )
      return null;
    const hasOverlay = typeof model.overlayTexture === "string";
    layers.push({ texture: model.texture, dyeable: hasOverlay });
    if (hasOverlay)
      layers.push({
        texture: model.overlayTexture as string,
        dyeable: false,
      });
  }
  if (!layers.length) return null;

  return {
    format: 1,
    item,
    kind: "layer",
    layer: model.layer,
    layers,
  };
};

const parseModel = (value: unknown, item: string): PublishedItemModel | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const model = value as Record<string, unknown>;
  if (model.format !== 1 || model.item !== item || !Array.isArray(model.groups)) return null;
  const groups: PublishedGroup[] = [];
  for (const raw of model.groups) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const group = raw as Record<string, unknown>;
    if (
      !Number.isInteger(group.tint) ||
      !isNumberArray(group.positions, 18) ||
      !isNumberArray(group.uvs, 12) ||
      group.positions.length / 3 !== group.uvs.length / 2
    )
      return null;
    if (
      group.texture != null &&
      !safeRelativePath(group.texture)
    )
      return null;
    groups.push({
      ...(typeof group.texture === "string" ? { texture: group.texture } : {}),
      tint: group.tint as number,
      positions: group.positions,
      uvs: group.uvs,
    });
  }
  return {
    format: 1,
    item,
    groups,
    ...(typeof model.fingerprint === "string" ? { fingerprint: model.fingerprint } : {}),
  };
};

/**
 * Loads server-published BlueMap3D item geometry and turns it directly into Three.js meshes.
 * Minecraft resource-pack semantics have already been resolved server-side by BlueMap3D.
 */
export class EquipmentModelLoader {
  private readonly models = new Map<string, Promise<PublishedItemModel | null>>();
  private readonly armorModels = new Map<string, Promise<PublishedArmorModel | null>>();
  private readonly textures = new Map<string, Promise<Texture | null>>();
  private readonly textureLoader: InstanceType<BlueMapRuntime["Three"]["TextureLoader"]>;

  constructor(
    private readonly api: BlueMapRuntime,
    private readonly base: string,
    private readonly fetcher: ModelFetcher = (input) => fetch(input),
  ) {
    this.textureLoader = new api.Three.TextureLoader();
  }

  dispose(): void {
    for (const pending of this.textures.values()) {
      void pending.then((texture) => texture?.dispose());
    }
    this.textures.clear();
    this.models.clear();
    this.armorModels.clear();
  }

  async armor(item: string): Promise<LoadedArmorModel | null> {
    const model = await this.armorModel(item);
    if (!model) return null;
    if (model.kind === "custom") {
      const texture = await this.loadTexture(model.texture);
      return texture ? { kind: "custom", texture, parts: model.parts } : null;
    }
    const layers: { texture: Texture; dyeable: boolean }[] = [];
    for (const layer of model.layers) {
      const texture = await this.loadTexture(layer.texture);
      if (texture) layers.push({ texture, dyeable: layer.dyeable });
    }
    return layers.length
      ? { kind: "layer", layer: model.layer, layers }
      : null;
  }

  async build(item: string): Promise<BuiltEquipmentModel | null> {
    const model = await this.model(item);
    if (!model?.groups.length) return null;

    const root = new this.api.Three.Group();
    const parts: Object3D[] = [];
    const geometries: Geometry[] = [];
    const materials: Material[] = [];

    try {
      for (const group of model.groups) {
        const geometry = new this.api.Three.BufferGeometry();
        geometry.setAttribute(
          "position",
          new this.api.Three.Float32BufferAttribute(new Float32Array(group.positions), 3),
        );
        geometry.setAttribute(
          "uv",
          new this.api.Three.Float32BufferAttribute(new Float32Array(group.uvs), 2),
        );

        const texture = group.texture ? await this.loadTexture(group.texture) : null;
        const material = new this.api.Three.MeshBasicMaterial({
          color: group.tint,
          ...(texture ? { map: texture } : {}),
          transparent: true,
          alphaTest: 0.05,
          side: this.api.Three.DoubleSide,
          depthTest: true,
          depthWrite: true,
        });
        const mesh = new this.api.Three.Mesh(geometry, material);
        root.add(mesh);
        parts.push(mesh);
        geometries.push(geometry);
        materials.push(material);
      }
      if (!parts.length) return null;
      return { root, parts, geometries, materials };
    } catch {
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
      return null;
    }
  }

  private armorModel(item: string): Promise<PublishedArmorModel | null> {
    const id = resourceId(item);
    if (!id) return Promise.resolve(null);
    const cached = this.armorModels.get(item);
    if (cached) return cached;

    const relative =
      "armor/" +
      encodeURIComponent(id.namespace) +
      "/" +
      id.path
        .split("/")
        .map(encodeURIComponent)
        .join("/") +
      ".json";
    const promise = this.fetcher(new URL(relative, this.base))
      .then(async (response) =>
        response.ok ? parseArmorModel(await response.json(), item) : null,
      )
      .catch(() => null)
      .then((model) => {
        if (!model) this.armorModels.delete(item);
        return model;
      });
    this.armorModels.set(item, promise);
    return promise;
  }

  private model(item: string): Promise<PublishedItemModel | null> {
    const id = resourceId(item);
    if (!id) return Promise.resolve(null);
    const cached = this.models.get(item);
    if (cached) return cached;

    const relative =
      "models/" +
      encodeURIComponent(id.namespace) +
      "/" +
      id.path
        .split("/")
        .map(encodeURIComponent)
        .join("/") +
      ".json";
    const url = new URL(relative, this.base);
    const promise = this.fetcher(url)
      .then(async (response) => (response.ok ? parseModel(await response.json(), item) : null))
      .catch(() => null)
      .then((model) => {
        // A model can be requested before the publisher sees a newly registered item.
        // Do not turn that transient 404 into a permanent browser cache entry.
        if (!model) this.models.delete(item);
        return model;
      });
    this.models.set(item, promise);
    return promise;
  }

  private loadTexture(relative: string): Promise<Texture | null> {
    const url = new URL(relative, this.base).href;
    const cached = this.textures.get(url);
    if (cached) return cached;

    const promise = new Promise<Texture | null>((resolve) => {
      this.textureLoader.load(
        url,
        (texture) => {
          texture.flipY = true;
          if (this.api.Three.NearestFilter !== undefined) {
            texture.magFilter = this.api.Three.NearestFilter;
            texture.minFilter = this.api.Three.NearestFilter;
          }
          texture.generateMipmaps = false;
          texture.needsUpdate = true;
          resolve(texture);
        },
        undefined,
        () => {
          this.textures.delete(url);
          resolve(null);
        },
      );
    });
    this.textures.set(url, promise);
    return promise;
  }
}
