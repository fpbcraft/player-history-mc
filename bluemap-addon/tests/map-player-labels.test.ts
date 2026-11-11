// @vitest-environment jsdom
import assert from "node:assert/strict";
import { test } from "vitest";
import { MapPlayerLabels } from "../src/map-player-labels.js";

const pointer = (target: Element, type: string, x = 5, y = 5) => {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerType: "touch", clientX: x, clientY: y });
  target.dispatchEvent(event);
};

test("map labels toggle on tap, dismiss outside and ignore map drags", () => {
  document.body.innerHTML =
    '<div class="history-offline-location"><img></div><div class="bm-marker-player"><img></div>';
  const controller = new AbortController();
  new MapPlayerLabels(controller.signal);
  const [offline, online] = [...document.body.children] as HTMLElement[];
  const tap = (node: Element) => {
    pointer(node, "pointerdown");
    pointer(node, "pointerup");
  };
  tap(offline);
  assert.equal(offline.dataset.historyLabelOpen, "true");
  tap(online);
  assert.equal(offline.dataset.historyLabelOpen, undefined);
  assert.equal(online.dataset.historyLabelOpen, "true");
  tap(online);
  assert.equal(online.dataset.historyLabelOpen, undefined);
  pointer(offline, "pointerdown");
  pointer(offline, "pointerup", 30, 30);
  assert.equal(offline.dataset.historyLabelOpen, undefined);
  tap(offline);
  tap(document.body);
  assert.equal(offline.dataset.historyLabelOpen, undefined);
  tap(offline);
  controller.abort();
  assert.equal(offline.dataset.historyLabelOpen, undefined);
  tap(offline);
  assert.equal(offline.dataset.historyLabelOpen, undefined);
});

test("marker gesture starts do not bubble into map controls", () => {
  document.body.innerHTML = '<main><div class="history-offline-location"></div></main>';
  const controller = new AbortController();
  new MapPlayerLabels(controller.signal);
  const map = document.querySelector("main");
  assert.ok(map);
  const marker = map.firstElementChild;
  assert.ok(marker);
  let starts = 0;
  for (const type of ["pointerdown", "touchstart", "mousedown"])
    map.addEventListener(type, () => starts++, { signal: controller.signal });
  pointer(marker, "pointerdown");
  marker.dispatchEvent(new Event("touchstart", { bubbles: true }));
  marker.dispatchEvent(new Event("mousedown", { bubbles: true }));
  assert.equal(starts, 0);
  pointer(map, "pointerdown");
  assert.equal(starts, 1, "normal map gestures remain available");
  controller.abort();
});
