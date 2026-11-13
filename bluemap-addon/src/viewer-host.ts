import type { MapAdapter, ObjectMapAdapter } from "./map-adapter.js";
import type { IntegrationMapping } from "./types.js";

export interface ViewerHost {
  readonly baseUrl: URL;
  readonly objectManifestName?: "diorama-manifest.json";
  readonly mapRoot?: string | undefined;
  createAdapter(): MapAdapter;
  createObjectAdapter?(): Promise<ObjectMapAdapter>;
  integration?(signal: AbortSignal): Promise<IntegrationMapping>;
  switchMap(mapId: string): Promise<void>;
}

let factory: (() => ViewerHost) | undefined;
/** Register before mounting a panel. Each panel owns and disposes its adapters. */
export const configureViewerHost = (create: () => ViewerHost): void => {
  factory = create;
};
export const createViewerHost = (): ViewerHost => {
  if (!factory) throw new Error("Player History map host has not been configured");
  return factory();
};
