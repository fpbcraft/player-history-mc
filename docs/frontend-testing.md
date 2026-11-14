# Frontend visual and integration testing

Player History has two browser-testing modes. They intentionally solve different problems.

## Deterministic visual fixture

The visual fixture renders the production Preact UI and production CSS against fixed test data. It does not require Minecraft, NeoForge, BlueMap, or a running fpbcraft server.

Run:

```bash
cd bluemap-addon
npm ci
npm run visual:test
```

The command builds the fixture, launches an installed Chrome/Chromium in headless mode, checks basic layout invariants, and writes screenshots plus a JSON report to `bluemap-addon/visual-output/`.

The canonical scenarios are desktop, player filter, range selector, chat panel, and mobile. CI uploads the raw output as the `player-history-visual-*` workflow artifact so screenshots and the JSON report remain available from the workflow run.

This is the fast regression layer for UI changes. Fixture data must stay deterministic: do not use the current clock, random values, network calls, or data from the live server.

## Vercel live-backend preview

The repository-root Vercel project now builds a complete Diorama PR viewer with `npm --prefix bluemap-addon run build:preview`:

1. build Player History from the PR;
2. fetch the exact public Diorama commit pinned by the browser CI checkout;
3. copy its standalone HTML, modules, shader and deterministic noise into the preview output;
4. serve the PR's `/player-history/diorama-history.js`, CSS and versioned modules;
5. proxy map metadata, terrain, public history, vehicles, markers and chat to `https://map.fpbcraft.com`.

The Vercel project's existing Git integration creates a preview for every branch/PR. Keep its root directory at the repository root. The preview opens Diorama directly; the existing BlueMap addon asset rewrite rules remain available for compatibility. No Minecraft client or server JAR update is needed to review frontend changes in that preview. Backend behavior still comes from the server's installed build.

The source pin must be a full commit SHA, and the standalone frontend must include every worker/shader resource. A missing export fails the build instead of silently using production frontend files. `/frontend-preview.json` records the Diorama source commit and the Player History deployment commit. Core frontend PRs need a paired Player History pin update to generate a preview for that core change.

The public origin must be up and accessible from Vercel. Local/Tailscale-only lab addresses cannot be fetched by its hosted proxy. Preview requests use the real backend, including its authenticated chat API. Rewrite caching stays disabled for live data.

### What each mode catches

Use the deterministic fixture and its CI artifact for layout, responsive behavior, controls, component rendering, and screenshot evidence.

Use the Vercel preview for real Diorama integration, 3D player/object rendering, live data, map switching, skins/assets, and backend compatibility.

Minecraft-side recording, persistence, provider discovery, and mod interoperability still require Java/integration coverage or a disposable server test; the browser layers do not replace those tests.
