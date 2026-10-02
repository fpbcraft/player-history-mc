# Contributing

Player History has two independent NeoForge modules plus the BlueMap viewer. Changes should keep recorder storage/protocol concerns separate from browser presentation concerns and preserve compatibility deliberately.

## Repository boundaries

- `recorder-neoforge/` owns server-side recording, retention, storage, recovery, and public dataset publication.
- `bluemap-neoforge/` owns the BlueMap integration/mod packaging and must not depend on recorder implementation classes.
- `bluemap-addon/` owns the browser viewer, protocol decoding, replay state, UI, and BlueMap adapters.
- `docs/` is part of the public contract when it describes configuration, binary formats, migration, or the public protocol.

Prefer small state/loader/session abstractions over adding more responsibilities to `ReplayPanel` or recorder storage classes.

## Compatibility rules

Treat these as compatibility-sensitive:

- public protocol shapes and fixture data;
- movement, event, state, inventory, and object-history binary formats;
- chunk naming/layout and recovery behavior;
- config keys/defaults;
- retention semantics;
- object/player identity and world mappings.

When changing one of these, update the relevant regression fixtures/tests and documentation in the same PR. Keep backwards compatibility explicit; do not silently reinterpret existing recordings.

## Development workflow

Use a focused branch such as `fix/...`, `refactor/...`, `feat/...`, or `chore/...`. Keep each PR to one responsibility and avoid unrelated formatting churn.

For refactors, preserve behavior with focused tests before or alongside the extraction. In the viewer, prefer pure tests for loaders/state/session logic and keep DOM/browser integration thin.

Install and verify the viewer with:

```bash
npm ci --prefix bluemap-addon
npm --prefix bluemap-addon run check
```

Verify the NeoForge modules with:

```bash
./gradlew test build
```

Run both before considering a cross-layer change complete. CI performs the same viewer check and mod build/test path.

For interactive viewer work against BlueMap:

```bash
npm --prefix bluemap-addon run dev -- --target http://127.0.0.1:8100
```

Do not commit generated `build/`, `outputs/`, `bluemap-addon/dist/`, `node_modules/`, or `bin/` content.

## Protocol and storage changes

Shared Java/TypeScript protocol fixtures are the preferred regression boundary for data that crosses recorder/viewer layers. A protocol change should normally include:

1. writer/producer changes;
2. parser/consumer changes;
3. fixture updates;
4. backwards-compatibility coverage where old data remains supported;
5. documentation updates.

Storage changes should include recovery/truncation/corruption behavior where relevant, not only the happy path.

## Releases

The Gradle `modVersion` value is the baseline semantic version. Ordinary builds append an immutable development suffix from the commit SHA; published releases use the exact SemVer tag.

Do not independently version the private viewer package or commit built viewer assets as a release mechanism. Release workflow changes should keep the recorder mod, BlueMap mod, and embedded viewer on one resolved version.

## Pull requests

PRs should state:

- which layer owns the change;
- whether protocol/storage/config compatibility changes;
- how the behavior was verified;
- whether migration or documentation changes are required.

Cleanup PRs should remain behavior-preserving unless a behavior change is explicitly included and tested.
