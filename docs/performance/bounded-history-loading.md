# Bounded history loading and recovery

Trail/event scans previously retained every decoded chunk before enforcing browser limits. They now consume ordered batches at the configured concurrency, enforce event counts before appending, and stop scheduling when a limit fails. Chunk ordering, gap flags and final sorting remain unchanged. In-flight requests in the current batch can finish; no later batch starts.

Chunk reads share pending work across seek and analytics consumers. Cancelling one consumer preserves another; cancelling the last consumer aborts and removes the pending request so an immediate retry can start fresh. Cache clear aborts sources and rejects obsolete late bodies before caching. State-history TTL starts on completion, avoiding duplicate reads when a request takes longer than five seconds. State reads are shared even if the resolved-cache entry is evicted, and disconnection clears their requests.

Previously unbounded chunk, state, activity, heatmap, object-manifest, server-time and overlay fetches now have 15-second deadlines. Existing live/chat independence and online/visibility recovery remain in place. A deadline releases each poller's loading gate through its existing finally path; it does not promise immediate recovery on a suspended browser timer.

## Reproducible range comparison

Run `node docs/performance/tools/measure-history-range.mjs` from the repository root. It builds baseline `1fa0b72` and the working candidate, then runs each in a fresh Node process. The synthetic fixture has 5,000 chunks of 1,000 event references, concurrency three, and the existing 100,000-event limit. It asserts that both reject the oversized range.

| Metric | Before | After |
|---|---:|---:|
| Chunk requests before rejection | 5,000 | 102 |
| Single local run | 12.68 ms | 2.28 ms |
| Peak process RSS | 114,688 KiB | 52,384 KiB |

The request reduction is deterministic for this fixture. Elapsed time and process RSS are local measurements with Node startup/runtime overhead, not browser p95 or network timing claims. At most one batch of decoded chunks is retained by the scan, instead of the full range. Successful scans may trade some network throughput for a bounded working set when one batch member is slow.

Validation: frontend typecheck, lint, bundle build and 160 tests pass, including shared-reader cancellation, immediate retry, deadline retry, cache-clear late completion, slow state reads and early range-limit enforcement. Matched browser/soak validation remains a release gate.
