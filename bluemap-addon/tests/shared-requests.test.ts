import assert from "node:assert/strict";
import { test } from "vitest";
import { SharedRequests } from "../src/shared-requests.js";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("one cancelled reader does not cancel a shared pending read", async () => {
  const requests = new SharedRequests<number, string>();
  const gate = deferred<string>();
  let reads = 0;
  let sourceSignal!: AbortSignal;
  const load = async (signal: AbortSignal) => {
    reads++;
    sourceSignal = signal;
    return gate.promise;
  };
  const owner = new AbortController();
  const first = requests.read(0, load, owner.signal);
  const second = requests.read(0, load);
  await Promise.resolve();
  owner.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(sourceSignal.aborted, false);
  gate.resolve("ok");
  assert.equal(await second, "ok");
  assert.equal(reads, 1);
});

test("last cancelled reader aborts the source and an immediate retry starts fresh", async () => {
  const requests = new SharedRequests<number, string>();
  const gate = deferred<string>();
  const owner = new AbortController();
  let sourceSignal!: AbortSignal;
  const first = requests.read(
    0,
    async (signal) => {
      sourceSignal = signal;
      return gate.promise;
    },
    owner.signal,
  );
  await Promise.resolve();
  owner.abort();
  await assert.rejects(first);
  assert.equal(sourceSignal.aborted, true);
  const next = requests.read(0, async () => "fresh");
  gate.resolve("obsolete");
  assert.equal(await next, "fresh");
});
