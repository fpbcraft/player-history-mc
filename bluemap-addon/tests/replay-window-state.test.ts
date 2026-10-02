import assert from "node:assert/strict";
import { test } from "vitest";
import { ReplayWindowState } from "../src/replay-window-state.js";

test("replay window state tracks pending and loaded buckets", () => {
  const state = new ReplayWindowState();

  assert.equal(state.needsLoad(150, 100), true);
  const request = state.begin(150, 100);
  assert.equal(state.needsLoad(150, 100), false);
  assert.equal(state.isLoaded(150, 100), false);
  assert.equal(state.accept(request, 150, 100), true);

  assert.equal(state.markLoaded(request), true);
  assert.equal(state.isLoaded(150, 100), true);
  assert.equal(state.finish(request), true);
  assert.equal(state.needsLoad(150, 100), false);
  assert.equal(state.needsLoad(250, 100), true);
});

test("a newer request makes an older request obsolete without clearing its pending state", () => {
  const state = new ReplayWindowState();
  const first = state.begin(150, 100);
  const second = state.begin(250, 100);

  assert.equal(state.isCurrent(first), false);
  assert.equal(state.accept(first, 150, 100), false);
  assert.equal(state.markLoaded(first), false);
  assert.equal(state.finish(first), false);

  assert.equal(state.needsLoad(250, 100), false);
  assert.equal(state.accept(second, 250, 100), true);
  assert.equal(state.markLoaded(second), true);
  assert.equal(state.finish(second), true);
  assert.equal(state.isLoaded(250, 100), true);
});

test("moving to another bucket rejects an otherwise current request", () => {
  const state = new ReplayWindowState();
  const request = state.begin(150, 100);

  assert.equal(state.accept(request, 250, 100), false);
  assert.equal(state.finish(request), true);
  assert.equal(state.needsLoad(250, 100), true);
});

test("reset invalidates in-flight requests and clears readiness", () => {
  const state = new ReplayWindowState();
  const request = state.begin(150, 100);
  state.markLoaded(request);

  state.reset();

  assert.equal(state.isCurrent(request), false);
  assert.equal(state.isLoaded(150, 100), false);
  assert.equal(state.needsLoad(150, 100), true);
});
