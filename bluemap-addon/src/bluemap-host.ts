import { BlueMapAdapter } from "./bluemap-adapter.js";
import type { BlueMapApp, BlueMapRuntime } from "./bluemap-types.js";
import type { ViewerHost } from "./viewer-host.js";

declare global {
  interface Window {
    bluemap: BlueMapApp & { switchMap?(id: string, animate: boolean): Promise<void> };
    BlueMap: BlueMapRuntime;
  }
}

export const createBlueMapHost = (): ViewerHost => ({
  baseUrl: new URL("player-history/", document.baseURI),
  get mapRoot() {
    return window.bluemap?.mapViewer?.map?.data?.mapDataRoot;
  },
  createAdapter: () => new BlueMapAdapter(window.bluemap, window.BlueMap),
  createObjectAdapter: async () => {
    const { BlueMap3DReplayAdapter } = await import("./bluemap3d-replay-adapter.js");
    return new BlueMap3DReplayAdapter(window.BlueMap);
  },
  switchMap: async (id) => {
    await window.bluemap?.switchMap?.(id, false);
  },
});
