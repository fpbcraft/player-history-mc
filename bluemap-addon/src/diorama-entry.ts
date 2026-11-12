import { DioramaServerOverlays } from "./diorama-server-overlays.js";
import { DioramaAdapter } from "./diorama-adapter.js";
import type { DioramaApi } from "./diorama-api.js";
import { ReplayPanel } from "./replay-panel.js";
import { configureViewerHost } from "./viewer-host.js";

const mount = (api: DioramaApi): void => {
  if (api.version !== 1 || document.querySelector("bluemap-player-replay")) return;
  const baseUrl = new URL("/player-history/", location.origin);
  configureViewerHost(() => ({
    baseUrl,
    createAdapter: () => new DioramaAdapter(api, baseUrl),
    createObjectAdapter: async () => {
      const { DioramaObjectAdapter } = await import("./diorama-object-adapter.js");
      return new DioramaObjectAdapter(api);
    },
    integration: async () => ({
      get mapWorlds() {
        return Object.fromEntries((api.getState()?.dimensions ?? []).map((key) => [key, key]));
      },
    }),
    switchMap: async (id) => {
      if (!api.setDimension(id)) throw new Error("This dimension has no Diorama map");
    },
  }));
  if (!customElements.get("bluemap-player-replay"))
    customElements.define("bluemap-player-replay", ReplayPanel);
  const overlays = new DioramaServerOverlays(api, baseUrl);
  const panel = document.createElement("bluemap-player-replay");
  document.body.append(panel);
  api.events.addEventListener(
    "dispose",
    () => {
      panel.remove();
      overlays.dispose();
    },
    { once: true },
  );
};
// Map metadata arrives asynchronously, after the extension API becomes available.
const ready = (): void => {
  const api = window.diorama;
  if (!api) return;
  if (api.getState()) mount(api);
  else {
    const onMetadata = () => {
      if (!api.getState()) return;
      api.events.removeEventListener("change", onMetadata);
      mount(api);
    };
    api.events.addEventListener("change", onMetadata);
    api.events.addEventListener(
      "dispose",
      () => api.events.removeEventListener("change", onMetadata),
      { once: true },
    );
  }
};
if (window.diorama) ready();
else window.addEventListener("diorama:ready", ready, { once: true });
