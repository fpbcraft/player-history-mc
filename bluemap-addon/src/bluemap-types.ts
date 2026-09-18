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

export interface Geometry {
  setAttribute(name: string, value: unknown): void;
  dispose(): void;
}

export interface Material {
  dispose(): void;
}

export interface Quaternion3 {
  set(x: number, y: number, z: number, w: number): Quaternion3;
}

export interface Object3D {
  position: Position3;
  quaternion: Quaternion3;
  visible: boolean;
  name: string;
  userData: Record<string, unknown>;
  parent?: { remove(child: Object3D): void };
  add(...children: Object3D[]): void;
  remove(child: Object3D): void;
  clone(recursive?: boolean): Object3D;
}

export interface Mesh extends Object3D {
  geometry: Geometry;
  material: Material;
  renderOrder: number;
}

export interface RaycastHit {
  object: { userData: MarkerLine["userData"] };
  faceIndex: number;
  point: { x: number; y: number; z: number };
  pointOnLine?: { x: number; y: number; z: number };
}

export interface Raycaster {
  params: { Line2: { threshold: number } };
  setFromCamera(position: unknown, camera: unknown): void;
  intersectObjects(objects: MarkerLine[], recursive: boolean): RaycastHit[];
}

export interface BlueMapRuntime {
  MarkerSet: new (id: string, options: Record<string, unknown>) => MarkerSet;
  HtmlMarker: new (id: string) => HtmlMarker;
  LineMarker: new (id: string) => LineMarker;
  Three: {
    Raycaster: new () => Raycaster;
    Vector2: new (x: number, y: number) => unknown;
    Color: new () => {
      r: number;
      g: number;
      b: number;
      setHSL(h: number, s: number, l: number): { r: number; g: number; b: number };
    };
    BufferGeometry: new () => Geometry;
    Float32BufferAttribute: new (values: number[], size: number) => unknown;
    MeshBasicMaterial: new (options: Record<string, unknown>) => Material;
    Mesh: new (geometry: Geometry, material: Material) => Mesh;
    Group: new () => Object3D;
    DoubleSide: unknown;
  };
}

export interface BlueMapApp {
  popupMarkerSet: MarkerSet;
  mapViewer: {
    markers: unknown;
    camera: unknown;
    renderer: { domElement: HTMLElement };
    map?: { id?: string; data?: { id?: string; mapDataRoot?: string } };
    controlsManager?: {
      position?: Position3;
      updateCamera?(): void;
    };
  };
}
