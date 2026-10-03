import type { HistoryPoint } from "./types.js";

export interface Position3 {
  x?: number;
  y?: number;
  z?: number;
  set(x: number, y: number, z: number): void;
}

export interface MarkerLine {
  depthTest: boolean;
  linewidth: number;
  opacity: number;
  color: { setStyle(value: string): void };
  userData: { historyPoints?: HistoryPoint[]; historyName?: string };
}

export interface BlueMapMarker {
  element: HTMLElement;
  position: Position3;
  anchor: { set(x: number, y: number): void };
  line?: MarkerLine;
  offsetX?: number;
  offsetY?: number;
}

export interface HtmlMarker extends BlueMapMarker {}
export interface LineMarker extends BlueMapMarker {
  line: MarkerLine;
  setLine(points: number[]): void;
}

export interface MarkerSet {
  readonly markers: Map<string, HtmlMarker>;
  readonly children: BlueMapMarker[];
  add(...markers: unknown[]): void;
  remove(marker: unknown): void;
}

export interface BlueMapPopupMarker {
  element?: HTMLElement;
  cube?: { visible: boolean };
  visible?: boolean;
  onMapInteraction?: (event: unknown) => void;
}

export interface Geometry {
  setAttribute(name: string, value: unknown): void;
  setIndex?(value: unknown): void;
  dispose(): void;
}

export interface Texture {
  flipY: boolean;
  magFilter?: unknown;
  minFilter?: unknown;
  generateMipmaps?: boolean;
  needsUpdate?: boolean;
  dispose(): void;
}

export interface Material {
  map?: Texture | null;
  color?: { setStyle?(value: string): unknown };
  needsUpdate?: boolean;
  dispose(): void;
}

export interface Quaternion3 {
  set(x: number, y: number, z: number, w: number): Quaternion3;
  setFromAxisAngle?(axis: unknown, angle: number): Quaternion3;
}

export interface Matrix4 {
  makeTranslation(x: number, y: number, z: number): Matrix4;
}

export interface Object3D {
  position: Position3;
  scale: Position3;
  quaternion: Quaternion3;
  visible: boolean;
  name: string;
  userData: Record<string, unknown>;
  parent?: { remove(child: Object3D): void };
  add(...children: Object3D[]): void;
  remove(child: Object3D): void;
  clone(recursive?: boolean): Object3D;
  children?: Object3D[];
  onClick?: (event: unknown) => boolean;
}

export interface Mesh extends Object3D {
  geometry: Geometry;
  material: Material;
  renderOrder: number;
}

export interface RaycastHit {
  object: Object3D & { userData: Record<string, unknown> };
  faceIndex?: number;
  index?: number;
  instanceId?: number;
  point: { x: number; y: number; z: number };
  pointOnLine?: { x: number; y: number; z: number };
}

export interface Raycaster {
  params: { Line2: { threshold: number }; Line?: { threshold: number } };
  setFromCamera(position: unknown, camera: unknown): void;
  intersectObjects(objects: unknown[], recursive: boolean): RaycastHit[];
}

export interface BlueMapRuntime {
  MarkerSet: new (id: string, options: Record<string, unknown>) => MarkerSet;
  HtmlMarker: new (id: string) => HtmlMarker;
  LineMarker: new (id: string) => LineMarker;
  Three: {
    Raycaster: new () => Raycaster;
    Vector2: new (x: number, y: number) => unknown;
    Color: new (value?: string | number) => {
      r: number;
      g: number;
      b: number;
      setHSL(h: number, s: number, l: number): { r: number; g: number; b: number };
      setStyle?(value: string): unknown;
    };
    Vector3: new (x?: number, y?: number, z?: number) => unknown;
    Matrix4: new () => Matrix4;
    BufferGeometry: new () => Geometry;
    BoxGeometry: new (width: number, height: number, depth: number) => Geometry & {
      attributes?: {
        uv?: {
          set(values: Float32Array): void;
          needsUpdate: boolean;
        };
      };
    };
    Float32BufferAttribute: new (values: number[] | Float32Array, size: number) => unknown;
    Uint32BufferAttribute?: new (values: number[] | Uint32Array, size: number) => unknown;
    MeshBasicMaterial: new (options: Record<string, unknown>) => Material;
    LineBasicMaterial: new (options: Record<string, unknown>) => Material;
    TextureLoader: new () => {
      load(
        url: string,
        onLoad?: (texture: Texture) => void,
        onProgress?: unknown,
        onError?: (error: unknown) => void,
      ): Texture;
    };
    Mesh: new (geometry: Geometry, material: Material) => Mesh;
    Line: new (geometry: Geometry, material: Material) => Object3D & {
      geometry: Geometry;
      material: Material;
    };
    LineSegments: new (geometry: Geometry, material: Material) => Object3D & {
      geometry: Geometry;
      material: Material;
      renderOrder: number;
    };
    SphereGeometry: new (
      radius: number,
      widthSegments?: number,
      heightSegments?: number,
    ) => Geometry;
    InstancedMesh: new (geometry: Geometry, material: Material, count: number) => Object3D & {
      geometry: Geometry;
      material: Material;
      count: number;
      instanceMatrix?: { needsUpdate: boolean };
      instanceColor?: { needsUpdate: boolean };
      setMatrixAt(index: number, matrix: Matrix4): void;
      setColorAt?(index: number, color: unknown): void;
    };
    Group: new () => Object3D;
    DoubleSide: unknown;
    FrontSide?: unknown;
    NearestFilter?: unknown;
  };
}

export interface BlueMapApp {
  popupMarkerSet: MarkerSet;
  popupMarker?: BlueMapPopupMarker;
  playerMarkerManager?: {
    getPlayerMarker?(uuid: string): unknown;
  };
  mapViewer: {
    markers: unknown;
    camera: unknown;
    renderer: { domElement: HTMLElement };
    map?: { id?: string; data?: { id?: string; mapDataRoot?: string } };
    controlsManager?: {
      position?: Position3;
      distance?: number;
      updateCamera?(): void;
      controls?: {
        data?: { followingPlayer?: unknown | null };
        followPlayerMarker?(marker: unknown): void;
        stopFollowingPlayerMarker?(): void;
      };
    };
  };
}
