# First combined implementation: live readiness and replay performance

Implementation for review; not deployed. This combines related Player History fixes rather than opening separate PRs for each finding in the investigation.

- Live collection and avatar initialization use the presence registry independently of the historical manifest/cache. Historical bootstrap is deferred while the panel is closed.
- Chat public-feed and account-session requests have independent single-flight owners. Neither historical chunks nor a pending account check holds message polling. Closing history leaves chat polling active.
- The histogram requests its existing activity summary before awaiting object-history metadata. Detailed recordings remain separate.
- Closing history restores live display; subsequent animation frames cannot reinstall historical suppression.
- Follow intent survives temporary missing historical windows and rebinds to the new model. Explicit unfollow/manual pan still works.
- Playback composes once per animation step. Replay registry/geometry indexes are reused until their catalog changes; unchanged suppression does not repeat the global visibility pass.
- Occlusion filtering removes hidden/history subtrees before raycasting and limits rays to the player distance. Position interpolation respects the existing 100 ms render-event occlusion budget, while roster/world/zoom-mode changes update visibility immediately.
- JavaScript/CSS outputs are minified. JavaScript decreases from 294,862 to 169,529 bytes (42.5%). No protocol, storage or server tick-thread change.

## Preliminary verification already completed

- Frontend typecheck, lint, build and 145 tests pass.
- `./gradlew test build` passes: 55 module tests and packaging.
- Production-data replay comparison uses an isolated browser script override; production files/services are unchanged. Two baseline and two final-candidate trials alternate order without concurrent builds, on desktop Chrome/M3 Pro at 1440×900, same recorded player/segment at Y=46 and camera distance 100, 12-second measurement windows. The historical rendered-object count remains 907. Current live scene contents can vary slightly.

| Measurement | Baseline, two trials | Patched, two trials |
|---|---:|---:|
| Main-thread task time / 12-second window | 12.02 s | 8.43–8.45 s |
| Object replay composition time | 5.43–5.73 s | 1.59–1.61 s |
| Occlusion checks total time | 3.84–4.03 s | 0.91–0.98 s |
| Actual BlueMap render-event median interval | 70.0–78.2 ms | 42.9–43.8 ms |
| Actual BlueMap render-event p95 interval | 87.4–90.3 ms | 64.9–73.1 ms |
| Browser rAF p95 interval | 83.4 ms | 16.8 ms |

rAF frequency is not presented terrain FPS. The actual render-event measurements show a smaller improvement than rAF, and BlueMap's idle rendering policy remains. Callback timings are instrumented wall time, not additive exclusive CPU components. Small sample sizes do not establish field percentiles. Raw comparison results are in [the evidence folder](evidence/2026-11-10-first-fixes/).

In both baseline trials a backward seek clears following and closing history leaves roughly 906 active-world objects suppressed. Both candidate trials retain follow ID 2 and leave zero active-world objects suppressed after closing. Existing BlueMap startup exceptions remain in both variants; they are outside this addon change.

## Validation and work remaining

Review the deliverable before expanding testing. Physical mobile, controlled real online players/equipment, multi-hour soak, authenticated chat and a broader visual regression pass remain required. Browser fixtures can check blocked-history/session isolation but do not establish real actor freshness or authenticated message delivery. The production chat API outage requires its separate infrastructure fix.

Cross-dimension player cards, last-known offline locations, Nether interior rendering, bundle splitting, terrain/geometry scheduling and compression remain follow-up implementation work. This PR establishes the live/follow ownership those changes need.
