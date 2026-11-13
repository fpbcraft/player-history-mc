export interface WorldPosition {
  x: number;
  y: number;
  z: number;
  dimension?: string;
}
export interface DioramaViewport {
  referenceY?: number;
  dimension: string;
  dimensions: string[];
  u: number;
  v: number;
  scale: number;
  width: number;
  height: number;
  pixelRatio: number;
  projection: { sin: number; cos: number; facing: number };
}
export interface DioramaOverlay {
  element?: HTMLElement;
  draw?(context: CanvasRenderingContext2D, state: DioramaViewport): void;
  pointer?(event: PointerEvent, state: DioramaViewport): boolean;
}
export interface OverlayRegistration {
  invalidate(): void;
  remove(): void;
}
export interface DepthTile {
  u: number;
  v: number;
  units: number;
  pixels: number;
  url: string;
}
export interface DioramaApi {
  depthTiles?(): DepthTile[];
  vehicleFeed?(): string | undefined;
  registerVisibility?(key: string, label: string, icon?: string): void;
  visible?(key: string): boolean;
  setVisible?(key: string, value: boolean): void;
  version: 1;
  events: EventTarget;
  getState(): DioramaViewport | null;
  screen(point: WorldPosition): { x: number; y: number } | null;
  navigate(point: WorldPosition): boolean;
  setDimension(id: string): boolean;
  registerOverlay(id: string, overlay: DioramaOverlay): OverlayRegistration;
}
declare global {
  interface Window {
    diorama?: DioramaApi;
  }
}
