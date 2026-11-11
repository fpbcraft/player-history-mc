# Expanding roster: eight-player desktop/mobile check

The selector starts as an row of 22-pixel heads on a translucent light-grey group background, with hidden scrollbars. The first click/tap expands to 32-pixel heads and full names; selecting an expanded player follows/navigates. Outside interaction or Escape collapses it. Desktop details are hover-only for pointer users (keyboard focus remains supported), while non-hover mobile devices use touch taps. A desktop click does not pin a popup. Details contain only HP or a compact seen timestamp, without names, dimensions, activity or online/offline labels.

Names no longer use ellipsis or fixed card widths: each expanded item fits its name, wrapping only if necessary. Dimension outlines stay directly on the heads and offline skins are gray. Expansion animates; reduced-motion users get immediate transitions. Today's seen time uses e.g. `Seen 20:47`, with a short date added only for older days and a year only when different.

A real-Chrome layout probe used eight synthetic players (seven online and one offline), including a long name. Candidate Player History/BlueMap assets were injected only in that browser. Bulk BlueMap3D object loading was omitted in the isolated layout fixture. This is a UI regression check, not a frame-rate benchmark or physical-phone certification.

Results:

- Desktop 1280×800: collapsed strip 264×40, expanded strip about 517×60. All eight expanded players fit. Full name elements have no text overflow or ellipsis.
- Mobile 390×844 with actual CDP touch emulation and a non-hover/coarse pointer: collapsed strip 243×46 with all eight heads visible. Expanded strip 246×70, scrolling horizontally; every player was individually reached and tapped. Names remain complete within their item.
- Head animation sampled an intermediate width between the settled 22- and 32-pixel sizes.
- Desktop hover opens HP details and mouseleave dismisses them even after a click. Mobile hover does not open details; touch does. Every mobile popup stays within the viewport and clear of the map controls, and outside touch collapses the selector.
- Offline details contain only compact seen time. No browser exceptions occurred. Full viewer check passes all 152 tests.

Reproduce with `tools/verify-compact-roster.cjs` and the environment variables in `tools/README.md`. The current JSON report is `evidence/2026-11-10/compact-roster-expand-eight-players.json`; the preceding fixed-card measurement remains retained separately. Screenshots of desktop/mobile collapsed, expanded and detail states are under `build/validation/compact-roster/`.
