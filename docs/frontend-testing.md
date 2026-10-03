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

The canonical scenarios are desktop, player filter, range selector, chat panel, and mobile. CI still uploads the raw output as the `player-history-visual-*` workflow artifact.

### GitHub Pages visual previews

Successful visual runs are also published to GitHub Pages:

- `/main/` is the latest visual baseline from the default branch.
- `/pr/<number>/` is the latest visual result for that pull request.
- the Pages root lists the baseline plus the most recent PR previews.

For same-repository pull requests, CI posts one `Visual test preview` comment containing the stable Pages URL. New commits update the existing comment and replace that PR's screenshots instead of adding another comment.

The Pages content is stored on the `gh-pages` branch. The normal CI workflow ignores pushes to that branch so publishing screenshots cannot recursively start another CI run. The gallery keeps the latest 40 PR preview entries.

GitHub Pages must be configured once for this repository to publish from the `gh-pages` branch at `/ (root)`.

This is the fast regression layer for UI changes. Fixture data must stay deterministic: do not use the current clock, random values, network calls, or data from the live server.

## Vercel live-backend preview

The repository root `vercel.json` implements the same basic model as `npm run dev`, but for a hosted preview:

1. build the Player History frontend from the branch/PR;
2. serve requests for `player-history/player-history-*.js` and `.css` from that build;
3. proxy every other request to `https://map.fpbcraft.com`.

The result is a normal BlueMap page backed by the real fpbcraft server and its current Player History dataset, while the browser executes the frontend from the branch being reviewed.

With Vercel Git integration enabled for this repository, pushes to branches and pull requests get independent preview deployments automatically. The Vercel project should use the repository root as its root directory.

The preview intentionally disables rewrite caching so live/history data is not frozen by the preview layer.

### What each mode catches

Use the deterministic fixture and its Pages gallery for layout, responsive behavior, controls, component rendering, and screenshot evidence.

Use the Vercel preview for real BlueMap integration, 3D player/object rendering, live data, map switching, skins/assets, and backend compatibility.

Minecraft-side recording, persistence, provider discovery, and mod interoperability still require Java/integration coverage or a disposable server test; the browser layers do not replace those tests.
