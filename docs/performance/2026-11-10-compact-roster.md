# Compact roster: eight-player desktop/mobile check

Cards now occupy 52×56 CSS pixels and show only a skin head, short name and dimension border. Full names, dimension labels, HP and offline timestamps live in a reusable hover/focus detail popup; click/tap pins it, and Escape or an outside pointer press dismisses it. Sneaking/running and other activity text has been removed. Unchanged head DOM is retained even when health changes. Tooltip listeners and DOM are disposed with the adapter.

The real-Chrome layout probe used eight synthetic players (seven online and one offline), including a long name. Player History assets and the companion BlueMap webapp were injected only in that browser. Bulk BlueMap3D object loading was omitted in this isolated layout fixture; the actual map toolbar, overlays, zoom controls and global skins remained present. This is a UI regression check, not a rendering performance benchmark or physical-phone test.

Results:

- Desktop, 1280×800: all eight cards fit within one 472×70 strip, below the map toolbar. Details open on hover and keyboard focus, and Escape dismisses them.
- Mobile viewport, 390×844 with touch input: the strip is 246×66 and ends before the overlay/zoom control column. It scrolls horizontally instead of growing vertically. All eight players were scrolled into view and tapped individually.
- Every mobile detail popup stayed inside the viewport and to the left of the map controls. Tapping outside dismissed the popup. No document-wide horizontal overflow and no browser exceptions occurred.
- Activity text was absent; online details showed recorded HP and the offline card showed its last-location status.

The reproducible probe is `tools/verify-compact-roster.cjs`, using the same environment variables as `verify-player-roster.cjs`. Its JSON result is retained in `evidence/2026-11-10/compact-roster-eight-players.json`. Desktop/mobile screenshots (default and open details) are available locally under `build/validation/compact-roster/`.
