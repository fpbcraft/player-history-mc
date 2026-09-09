import { ReplayPanel } from "./replay-panel.js";

if (!customElements.get("bluemap-player-replay")) {
  customElements.define("bluemap-player-replay", ReplayPanel);
  document.body.append(document.createElement("bluemap-player-replay"));
}
