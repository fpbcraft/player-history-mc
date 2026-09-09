import assert from "node:assert/strict";
import { test } from "vitest";
import { BlueMapAdapter } from "../src/bluemap-adapter.js";
import { BREAK, mergePoints, ReplayEngine } from "../src/replay-core.js";

test("event layout keeps crowded markers on their recorded coordinates", () => {
  globalThis.innerWidth = 800;
  globalThis.innerHeight = 600;
  const adapter = Object.create(BlueMapAdapter.prototype);
  const markers = Array.from({ length: 8 }, () => {
    const marker = {};
    marker.element = {
      style: {
        setProperty(name, value) {
          this[name] = value;
        },
      },
      getBoundingClientRect: () => ({
        left: 386 + (marker.offsetX || 0),
        top: 286 + (marker.offsetY || 0),
        width: 28,
        height: 28,
      }),
    };
    return marker;
  });
  adapter.eventMarkers = new Map(markers.map((m, i) => [i, m]));
  adapter.layoutEvents();
  for (const m of markers) {
    assert.equal(m.offsetX, 0);
    assert.equal(m.offsetY, 0);
    assert.equal(m.element.style.translate, "0px 0px");
    assert.equal(m.element.style["--connector-length"], "0px");
  }
});
test("live movement extends batched trails without duplicate points or teleport connections", () => {
  const p = (time, x, flags = 0) => ({ player: 1, time, world: 1, x, y: 0, z: 0, flags });
  const points = mergePoints([
    { points: [p(0, 0), p(1000, 32)] },
    { points: [p(1000, 32), p(2000, 64), p(3000, 1000, BREAK), p(4000, 1032)] },
  ]);
  assert.equal(points.length, 5);
  const trails = new ReplayEngine(points).trails(1, 0, 4000);
  assert.equal(trails.length, 2);
  assert.equal(trails[0].at(-1).x, 64);
  assert.equal(trails[1][0].x, 1000);
});
test("expanded event groups hide peers and collapse back to the count marker", () => {
  const adapter = Object.create(BlueMapAdapter.prototype);
  const element = (list = null) => ({
    hidden: false,
    attributes: {},
    classList: { add() {}, remove() {} },
    querySelector: () => list,
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  });
  const list = { hidden: true, classList: { toggle() {} } };
  const group = { element: element(list) };
  const peer = { element: element() };
  adapter.eventMarkers = new Map([
    [1, group],
    [2, peer],
  ]);
  adapter.expandEventGroup(group);
  assert.equal(list.hidden, false);
  assert.equal(peer.element.hidden, true);
  assert.equal(group.element.attributes["aria-expanded"], "true");
  adapter.collapseEventGroup();
  assert.equal(list.hidden, true);
  assert.equal(peer.element.hidden, false);
  assert.equal(group.element.attributes["aria-expanded"], "false");
});
test("chat bubbles stack vertically without overlap in timestamp order", () => {
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 800;
  const adapter = Object.create(BlueMapAdapter.prototype);
  const times = [30, 10, 20];
  const markers = times.map((time) => {
    const marker = {};
    marker.element = {
      className: "history-event history-chat-bubble",
      dataset: { historyTime: String(time) },
      style: {
        setProperty(name, value) {
          this[name] = value;
        },
      },
      getBoundingClientRect: () => ({
        left: 500 + (marker.offsetX || 0),
        top: 350 + (marker.offsetY || 0),
        width: 220,
        height: 64,
      }),
    };
    return marker;
  });
  adapter.eventMarkers = new Map(markers.map((marker, index) => [index, marker]));
  adapter.layoutEvents();
  const byTime = markers.toSorted(
    (left, right) =>
      Number(left.element.dataset.historyTime) - Number(right.element.dataset.historyTime),
  );
  assert.deepEqual(
    byTime.map((marker) => marker.offsetX),
    [0, 0, 0],
  );
  assert.deepEqual(
    byTime.map((marker) => marker.offsetY),
    [0, 72, 144],
  );
  for (let index = 1; index < byTime.length; index++)
    assert.ok(byTime[index].offsetY - byTime[index - 1].offsetY >= 72);
});
