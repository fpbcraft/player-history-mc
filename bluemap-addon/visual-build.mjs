import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, "visual-dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await Promise.all([
  build({
    entryPoints: [join(root, "tests/visual/harness.tsx")],
    outfile: join(output, "harness.js"),
    bundle: true,
    format: "iife",
    target: "es2022",
    legalComments: "none",
    sourcemap: false,
    logLevel: "warning",
    define: {
      __PLAYER_HISTORY_VERSION__: JSON.stringify("visual-fixture"),
    },
  }),
  build({
    entryPoints: [join(root, "src/player-history.css")],
    outfile: join(output, "player-history.css"),
    bundle: true,
    target: "es2022",
    legalComments: "none",
    sourcemap: false,
    logLevel: "warning",
  }),
]);

await writeFile(
  join(output, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Player History visual fixture</title>
  <link rel="stylesheet" href="/player-history.css">
  <style>
    :root {
      --theme-bg: #181818;
      --theme-bg-hover: #2b2b2b;
      --theme-fg: #eee;
      --theme-fg-light: #aaa;
    }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body {
      background:
        radial-gradient(circle at 24% 28%, #55704f 0 8%, transparent 8.4%),
        radial-gradient(circle at 67% 58%, #394f64 0 11%, transparent 11.4%),
        linear-gradient(135deg, #243629, #18272d 48%, #1d2b23);
      color: var(--theme-fg);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .fixture-map-grid {
      position: fixed;
      inset: 0;
      opacity: .16;
      background-image:
        linear-gradient(#fff2 1px, transparent 1px),
        linear-gradient(90deg, #fff2 1px, transparent 1px);
      background-size: 48px 48px;
      transform: perspective(700px) rotateX(7deg) scale(1.08);
    }
    .fixture-brand {
      position: fixed;
      top: 64px;
      left: 20px;
      padding: 7px 10px;
      border-radius: 5px;
      background: #111b;
      border: 1px solid #fff2;
      font-size: 12px;
      letter-spacing: .02em;
    }
    .control-bar {
      position: fixed;
      z-index: 30;
      top: 8px;
      left: 8px;
      right: 8px;
      height: 42px;
      display: flex;
      align-items: stretch;
      background: #181818ed;
      border: 1px solid #fff2;
      box-shadow: 0 3px 12px #0008;
    }
    .control-bar > * {
      min-height: 40px;
      border: 0;
      border-left: 1px solid #fff2;
      color: #eee;
      background: #181818;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }
    .control-bar > :first-child { border-left: 0; }
    .fixture-menu,
    .fixture-compass,
    .day-night-switch {
      width: 48px;
      min-width: 48px;
      font-size: 20px;
    }
    .pos-input {
      flex: 1 1 auto;
      min-width: 0;
      padding: 0 14px;
      justify-content: flex-start;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    @media (max-width: 600px) {
      .control-bar {
        top: 0;
        left: 0;
        right: 0;
        height: 44px;
      }
      .control-bar > * { min-height: 44px; }
      .fixture-menu,
      .fixture-compass { width: 52px; min-width: 52px; }
      .thin-hide { display: none !important; }
      .fixture-brand { top: 56px; }
    }
    #zoom-buttons {
      position: fixed;
      right: 18px;
      bottom: 24px;
      display: grid;
      gap: 4px;
    }
    #zoom-buttons button {
      width: 38px;
      height: 38px;
      border: 1px solid #fff3;
      border-radius: 5px;
      background: #181818dd;
      color: #eee;
      font-size: 20px;
    }
  </style>
</head>
<body>
  <div class="fixture-map-grid"></div>
  <div class="fixture-brand">BlueMap fixture · deterministic data</div>
  <div id="zoom-buttons" aria-hidden="true"><button>+</button><button>−</button></div>
  <script src="/harness.js"></script>
</body>
</html>`,
  "utf8",
);

console.log(`Built visual fixture in ${output}`);
