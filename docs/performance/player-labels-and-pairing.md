# Compact map labels and persistent chat pairing

In-map offline heads and native online heads keep names/status hidden at rest. Desktop hover and keyboard focus reveal them; touch taps toggle the label, switch it to another player, or dismiss it outside. Icons remain hit-testable. Pointer, compatibility mouse and touch starts on a marker do not bubble into map gesture controls. Native marker names retain accessible labels when visual text is hidden. The separate player selector is unchanged.

The account pairing command previously shared chat-status output with the two-second session/feed poll, which erased it on the next poll. It now has a separate panel that survives unrelated polling and remains visible for the existing five-minute server code lifetime. Linking or logging out clears it, and old-token session responses cannot clear a newly issued code. No backend validity period or authentication behavior changes.

“Copy command” copies the complete `/webchat link CODE` string and confirms success. Clipboard denial leaves the command visible and selects it for manual copying. Late clipboard results do not overwrite a newer/expired command or a disconnected view.

Validation: frontend typecheck, lint, build and 164 tests pass. Regressions cover touch toggling/dismissal, drag rejection, gesture isolation, native marker accessibility, pairing survival across polls, full five-minute expiry, linking, successful copy and denied-copy fallback. The desktop/mobile Chrome component fixture uses eight synthetic map icons, actual production CSS/controller code and the actual clipboard handler; it confirms hidden resting labels, hover/touch reveal, far-distance name opacity and successful browser clipboard contents. It does not claim a controlled authenticated Minecraft linking session or physical-phone validation.

Reproduce the browser fixture with `PLAYWRIGHT_MODULE=/path/to/playwright node docs/performance/tools/verify-player-labels.cjs`. It writes screenshots/results under `build/validation/player-labels` and does not contact production. The broader real-map/vehicle probe is separate from this Player History PR.
