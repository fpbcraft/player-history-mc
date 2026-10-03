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

export type ArmorParent =
  | "head"
  | "torso"
  | "rightArm"
  | "leftArm"
  | "rightLeg"
  | "leftLeg";
export type ArmorSlot = "head" | "chest" | "legs" | "feet";

export interface WearableTransform {
  parent: ArmorParent;
  position: readonly [number, number, number];
  rotationDegrees: readonly [number, number, number];
  scale: number;
}

interface PublishedWearableConfig {
  format: 1;
  slots: Record<string, WearableTransform>;
  items: Record<string, WearableTransform>;
}

interface PublishedArmorLayer {
  texture: string;
  overlayTexture?: string | null;
  dyeable?: boolean;
  deformation?: number;
  headDeformation?: number;
}

export interface PublishedArmorPart {
  parent: ArmorParent;
  slot: ArmorSlot;
  positions: number[];
  uvs: number[];
}

type PublishedArmorModel =
  | {
      format: 1 | 2;
      item: string;
      kind: "layers";
      layer: 1 | 2;
      layers: PublishedArmorLayer[];
    }
  | {
      format: 2;
      item: string;
      kind: "custom";
      texture: string;
      parts: PublishedArmorPart[];
    };

export interface BuiltEquipmentModel {
  root: Object3D;
  parts: Object3D[];
  geometries: Geometry[];
  materials: Material[];
}

export type LoadedArmorModel =
  | {
      kind: "layers";
      layer: 1 | 2;
      layers: {
        texture: Texture;
        overlayTexture?: Texture;
        dyeable: boolean;
        deformation?: number;
        headDeformation?: number;
      }[];
    }
  | {
      kind: "custom";
      texture: Texture;
      parts: PublishedArmorPart[];
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

const ARMOR_PARENTS = new Set<ArmorParent>([
  "head",
  "torso",
  "rightArm",
  "leftArm",
  "rightLeg",
  "leftLeg",
]);
const ARMOR_SLOTS = new Set<ArmorSlot>(["head", "chest", "legs", "feet"]);

const parseArmorLayer = (value: unknown): PublishedArmorLayer | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const layer = value as Record<string, unknown>;
  const validDeformation = (candidate: unknown) =>
    typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate >= -1 &&
    candidate <= 4;
  if (
    !safeRelativePath(layer.texture) ||
    (layer.overlayTexture != null && !safeRelativePath(layer.overlayTexture)) ||
    (layer.deformation != null && !validDeformation(layer.deformation)) ||
    (layer.headDeformation != null && !validDeformation(layer.headDeformation))
  )
    return null;
  return {
    texture: layer.texture,
    ...(typeof layer.overlayTexture === "string"
      ? { overlayTexture: layer.overlayTexture }
      : {}),
    ...(typeof layer.dyeable === "boolean" ? { dyeable: layer.dyeable } : {}),
    ...(typeof layer.deformation === "number"
      ? { deformation: layer.deformation }
      : {}),
    ...(typeof layer.headDeformation === "number"
      ? { headDeformation: layer.headDeformation }
      : {}),
  };
};

const parseArmorModel = (value: unknown, item: string): PublishedArmorModel | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const model = value as Record<string, unknown>;
  if (model.item !== item) return null;

  // #42 published one base texture and optional overlay directly.
  if (
    model.format === 1 &&
    model.kind === undefined &&
    (model.layer === 1 || model.layer === 2) &&
    safeRelativePath(model.texture) &&
    (model.overlayTexture == null || safeRelativePath(model.overlayTexture))
  ) {
    return {
      format: 1,
      item,
      kind: "layers",
      layer: model.layer,
      layers: [
        {
          texture: model.texture,
          ...(typeof model.overlayTexture === "string"
            ? { overlayTexture: model.overlayTexture }
            : {}),
          dyeable: typeof model.overlayTexture === "string",
        },
      ],
    };
  }

  if (model.format !== 2) return null;
  if (model.kind === "layers") {
    if ((model.layer !== 1 && model.layer !== 2) || !Array.isArray(model.layers))
      return null;
    const layers = model.layers.map(parseArmorLayer);
    if (!layers.length || layers.some((layer) => !layer)) return null;
    return {
      format: 2,
      item,
      kind: "layers",
      layer: model.layer,
      layers: layers as PublishedArmorLayer[],
    };
  }

  if (model.kind === "custom") {
    if (!safeRelativePath(model.texture) || !Array.isArray(model.parts)) return null;
    const parts: PublishedArmorPart[] = [];
    for (const raw of model.parts) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const part = raw as Record<string, unknown>;
      if (
        typeof part.parent !== "string" ||
        !ARMOR_PARENTS.has(part.parent as ArmorParent) ||
        typeof part.slot !== "string" ||
        !ARMOR_SLOTS.has(part.slot as ArmorSlot) ||
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
    if (!parts.length) return null;
    return {
      format: 2,
      item,
      kind: "custom",
      texture: model.texture,
      parts,
    };
  }
  return null;
};

const parseVector3 = (value: unknown): [number, number, number] | null =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    ? [value[0] as number, value[1] as number, value[2] as number]
    : null;

const parseWearable = (value: unknown): WearableTransform | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.parent !== "string" ||
    !ARMOR_PARENTS.has(input.parent as ArmorParent) ||
    typeof input.scale !== "number" ||
    !Number.isFinite(input.scale) ||
    input.scale <= 0 ||
    input.scale > 4
  )
    return null;
  const position = parseVector3(input.position);
  const rotationDegrees = parseVector3(input.rotationDegrees);
  if (!position || !rotationDegrees) return null;
  return {
    parent: input.parent as ArmorParent,
    position,
    rotationDegrees,
    scale: input.scale,
  };
};

const parseWearableMap = (value: unknown): Record<string, WearableTransform> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, WearableTransform> = {};
  for (const [key, raw] of Object.entries(value)) {
    const wearable = parseWearable(raw);
    if (!wearable) return null;
    result[key] = wearable;
  }
  return result;
};

const parseWearableConfig = (value: unknown): PublishedWearableConfig | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.format !== 1) return null;
  const slots = parseWearableMap(input.slots);
  const items = parseWearableMap(input.items);
  return slots && items ? { format: 1, slots, items } : null;
};

const wildcardMatch = (pattern: string, value: string): boolean => {
  if (!pattern.includes("*")) return pattern === value;
  const parts = pattern.split("*");
  let cursor = 0;
  const first = parts[0] ?? "";
  if (first && !value.startsWith(first)) return false;
  cursor = first.length;
  for (let index = 1; index < parts.length - 1; index++) {
    const part = parts[index] ?? "";
    if (!part) continue;
    const found = value.indexOf(part, cursor);
    if (found < 0) return false;
    cursor = found + part.length;
  }
  const last = parts[parts.length - 1] ?? "";
  return !last || value.slice(cursor).endsWith(last);
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
    if (group.texture != null && !safeRelativePath(group.texture)) return null;
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
 * Loads server-published equipment geometry. Minecraft/resource-pack semantics and
 * custom-equipment discovery are resolved server-side; the browser only builds meshes.
 */
export class EquipmentModelLoader {
  private readonly models = new Map<string, Promise<PublishedItemModel | null>>();
  private readonly armorModels = new Map<string, Promise<PublishedArmorModel | null>>();
  private readonly textures = new Map<string, Promise<Texture | null>>();
  private wearableConfig?: Promise<PublishedWearableConfig | null>;
  private readonly textureLoader: InstanceType<BlueMapRuntime["Three"]["TextureLoader"]>;

  constructor(
    private readonly api: BlueMapRuntime,
    private readonly base: string,
    private readonly fetcher: ModelFetcher = (input) => fetch(input),
    private readonly assetVersion = "",
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
    this.wearableConfig = undefined;
  }

  async wearable(slot: string, item: string): Promise<WearableTransform | null> {
    const config = await this.wearables();
    if (!config) return null;
    const exact = config.items[item];
    if (exact) return exact;
    for (const [pattern, transform] of Object.entries(config.items)) {
      if (pattern.includes("*") && wildcardMatch(pattern, item)) return transform;
    }
    return config.slots[slot] ?? null;
  }

  async armor(item: string): Promise<LoadedArmorModel | null> {
    const model = await this.armorModel(item);
    if (!model) return null;

    if (model.kind === "custom") {
      const texture = await this.loadTexture(model.texture);
      return texture ? { kind: "custom", texture, parts: model.parts } : null;
    }

    const layers: Extract<LoadedArmorModel, { kind: "layers" }>["layers"] = [];
    for (const layer of model.layers) {
      const texture = await this.loadTexture(layer.texture);
      if (!texture) continue;
      const overlayTexture = layer.overlayTexture
        ? await this.loadTexture(layer.overlayTexture)
        : null;
      layers.push({
        texture,
        ...(overlayTexture ? { overlayTexture } : {}),
        dyeable: layer.dyeable === true,
        ...(layer.deformation !== undefined
          ? { deformation: layer.deformation }
          : {}),
        ...(layer.headDeformation !== undefined
          ? { headDeformation: layer.headDeformation }
          : {}),
      });
    }
    return layers.length
      ? { kind: "layers", layer: model.layer, layers }
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

  private wearables(): Promise<PublishedWearableConfig | null> {
    if (this.wearableConfig) return this.wearableConfig;
    const url = new URL("wearables.json", this.base);
    if (this.assetVersion) url.searchParams.set("v", this.assetVersion);
    this.wearableConfig = this.fetcher(url)
      .then(async (response) =>
        response.ok ? parseWearableConfig(await response.json()) : null,
      )
      .catch(() => null);
    return this.wearableConfig;
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
    const url = new URL(relative, this.base);
    if (this.assetVersion) url.searchParams.set("v", this.assetVersion);
    const promise = this.fetcher(url)
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
    if (this.assetVersion) url.searchParams.set("v", this.assetVersion);
    const promise = this.fetcher(url)
      .then(async (response) =>
        response.ok ? parseModel(await response.json(), item) : null,
      )
      .catch(() => null)
      .then((model) => {
        if (!model) this.models.delete(item);
        return model;
      });
    this.models.set(item, promise);
    return promise;
  }

  private loadTexture(relative: string): Promise<Texture | null> {
    const parsed = new URL(relative, this.base);
    if (this.assetVersion) parsed.searchParams.set("v", this.assetVersion);
    const url = parsed.href;
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
