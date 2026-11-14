# Object geometry publication during startup

A dedicated-server log from 2026-11-14 reached Minecraft's `Done` message at
09:31:55, but a lifecycle callback still prevented startup from completing.
At 09:33:35, MINT Lib's watchdog captured the server thread in:

```text
Files.copy
ObjectGeometryArchive.copyAtomically
ObjectGeometryArchive.publishEntry
ObjectGeometryArchive.publishTo
ObjectHistoryRecorder.publishTo
PlayerHistoryMod.start
ServerLifecycleHooks.handleServerStarted
```

Spark continued reporting world-statistics timeouts through 09:39:05. This is
one thread sample, so it identifies the blocking operation but does not prove
whether the filesystem was stalled or the archive simply contained many files.
The log also contains an earlier, separate main-thread silence of about 135
seconds, which this change does not diagnose or claim to fix.

Previously, publication recopied every archived mesh/sprite and atlas during
`ServerStartedEvent`, even when complete public copies survived the restart.
The archive monitor stayed locked across the entire copy loop; simply moving
that loop to a thread would still allow snapshots to block on the same lock.

Publication now queues version keys and lets the existing object writer process
one entry between recording/maintenance iterations. Public copying releases the
metadata monitor so snapshots can update references while filesystem IO is slow.
Retention serializes with publication using a separate lock, preventing an
in-flight copy from recreating expired public files. New archive versions join
the same queue; repeated requests for one version coalesce.

Versioned public paths are immutable and written with atomic replacement. A
regular public file with the same size as its archived source is reused; missing
or differently sized files are restored. This deliberately avoids reading every
public file to hash it at restart, and does not detect same-size external
corruption. Failed entries are logged individually and do not stop recording or
later entries; a subsequent publication request/restart queues them again.

When public files need rebuilding, historical geometry becomes available
progressively. The durable archive is preserved. Startup no longer waits for
public geometry copies, but the writer can still be delayed by a single slow
filesystem operation and its existing recording queue remains bounded.

Regression coverage includes a deliberately blocked publisher while metadata
updates complete, restart reuse, missing/truncated-file repair, per-entry failure
isolation, destination changes, retention races, coalescing, and recorder shutdown
without new snapshots. Full-modpack startup timing must still be measured on the
affected server; local tests are not a production speedup measurement.
