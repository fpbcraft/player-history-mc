import { createBlueMapHost } from "./bluemap-host.js";
import { configureViewerHost } from "./viewer-host.js";
import { ReplayPanel } from "./replay-panel.js";
import { startWorldOverlays } from "./world-overlays.js";
import { startWorldStatus } from "./world-status.js";

configureViewerHost(createBlueMapHost);

if (!customElements.get("bluemap-player-replay")) {
  customElements.define("bluemap-player-replay", ReplayPanel);
  document.body.append(document.createElement("bluemap-player-replay"));
}

void startWorldOverlays();
void startWorldStatus();
