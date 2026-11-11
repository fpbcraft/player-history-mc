import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { ChunkCache } from "../src/replay-core.js";

test("seek and analytics share a chunk, while cancelling the seek preserves analytics", async () => {
  let finish!: (body: string) => void;
  const body = new Promise<string>((resolve) => {
    finish = resolve;
  });
  let reads = 0;
  let sourceSignal!: AbortSignal;
  const cache = new ChunkCache("/history", 100, async (_url, options) => {
    reads++;
    sourceSignal = options?.signal as AbortSignal;
    return { ok: true, status: 200, text: async () => body };
  });
  const owner = new AbortController();
  const seek = cache.read(0, owner.signal);
  const analytics = cache.read(0);
  await Promise.resolve();
  owner.abort();
  await assert.rejects(seek);
  assert.equal(sourceSignal.aborted, false);
  finish('{"points":[],"events":[]}');
  await analytics;
  assert.equal(reads, 1);
});

test("cache clear prevents an obsolete body from repopulating the cache", async () => {
  let finish!: (body: string) => void;
  const body = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const cache = new ChunkCache("/history", 100, async () => ({
    ok: true,
    status: 200,
    text: async () => body,
  }));
  const pending = cache.read(0);
  await Promise.resolve();
  cache.clear();
  finish('{"points":[],"events":[]}');
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cache.cache.size, 0);
});

test("chunk deadline releases a stalled read and permits retry", async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  let reads = 0;
  const cache = new ChunkCache("/history", 100, async (_url, options) => {
    reads++;
    if (reads > 1) return { ok: true, status: 200, text: async () => '{"points":[],"events":[]}' };
    return new Promise((_resolve, reject) =>
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
        once: true,
      }),
    );
  });
  try {
    const pending = cache.read(0);
    await Promise.resolve();
    deadline.abort(new DOMException("Timed out", "TimeoutError"));
    await assert.rejects(pending, { name: "TimeoutError" });
    timeout.mockRestore();
    await cache.read(0);
    assert.equal(reads, 2);
  } finally {
    timeout.mockRestore();
  }
});
