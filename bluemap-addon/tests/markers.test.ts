import assert from "node:assert/strict";
import { test } from "vitest";
import { BlueMapAdapter, eventColor, meterLevels, playerColor } from "../src/bluemap-adapter.js";

class Element {
  constructor() {
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.textContent = "";
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  querySelector(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : null;
    for (const child of this.children) {
      if (
        className &&
        String(child.className || "")
          .split(" ")
          .includes(className)
      )
        return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 100, width: 100, height: 100 };
  }
  closest(selector) {
    return selector.split(",").some((s) => s.trim() === `.${this.className}`) ? this : null;
  }
  remove() {}
  get offsetWidth() {
    return 100;
  }
  get offsetHeight() {
    return 100;
  }
}
class Vector {
  set(x, y, z) {
    Object.assign(this, { x, y, z });
    return this;
  }
}
class Marker {
  constructor(id) {
    this.id = id;
    this.element = new Element();
    this.position = new Vector();
    this.anchor = new Vector();
    this.line = {
      userData: {},
      color: {
        setStyle(value) {
          this.value = value;
        },
      },
    };
  }
  setLine(points) {
    this.points = points;
  }
}
class SetMarker extends Marker {
  constructor(id) {
    super(id);
    this.children = [];
    this.markers = new Map();
  }
  add(...markers) {
    for (const m of markers) {
      this.children.push(m);
      this.markers.set(m.id, m);
    }
  }
  remove(m) {
    this.children = this.children.filter((child) => child !== m);
    this.markers.delete(m.id);
  }
}
test("Minecraft-style hearts use full, half, and empty icons", () => {
  assert.deepEqual(meterLevels(17, 20), [
    "full",
    "full",
    "full",
    "full",
    "full",
    "full",
    "full",
    "full",
    "half",
    "empty",
  ]);
  assert.deepEqual(meterLevels(undefined, 20), []);
});
test("skin heads, icon-only events, focus tooltips and exact trail dot", () => {
  const keys = [
    "document",
    "window",
    "innerWidth",
    "innerHeight",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ];
  const old = Object.fromEntries(keys.map((k) => [k, globalThis[k]]));
  try {
    globalThis.document = {
      createElement: () => new Element(),
      createElementNS: () => new Element(),
      body: new Element(),
      addEventListener() {},
    };
    globalThis.window = { addEventListener() {} };
    globalThis.innerWidth = 800;
    globalThis.innerHeight = 600;
    globalThis.cancelAnimationFrame = () => {};
    const app = {
      popupMarkerSet: new SetMarker("root"),
      mapViewer: {
        markers: {},
        map: { data: { id: "world", mapDataRoot: "maps/world" } },
        renderer: { domElement: new Element() },
        camera: {},
      },
    };
    const api = {
      MarkerSet: SetMarker,
      HtmlMarker: Marker,
      LineMarker: Marker,
      Three: {
        Vector2: Vector,
        Raycaster: class {
          constructor() {
            this.params = {};
          }
          setFromCamera() {}
          intersectObjects() {
            return this.hits ?? [];
          }
        },
      },
    };
    const adapter = new BlueMapAdapter(app, api);
    app.mapViewer.controlsManager = {
      position: new Vector(),
      updateCamera() {
        this.updated = true;
      },
    };
    assert.equal(adapter.focusPoint({ x: 320, y: 2048, z: -640 }), true);
    assert.deepEqual(
      {
        x: app.mapViewer.controlsManager.position.x,
        y: app.mapViewer.controlsManager.position.y,
        z: app.mapViewer.controlsManager.position.z,
      },
      { x: 10, y: 64, z: -20 },
    );
    assert.equal(app.mapViewer.controlsManager.updated, true);
    const names = new Map([[1, "Test player"]]);
    const point = {
      player: 1,
      time: 1000,
      world: 0,
      x: 0,
      y: 0,
      z: 0,
      flags: 0,
    };
    adapter.setPlayers([point], names, [{ id: 1, uuid: "abc" }]);
    const head = adapter.players.children[0];
    assert.equal(head.element.textContent, "");
    const image = head.element.children.find((child) => child.alt === "Player skin head");
    assert.equal(image.src, "maps/world/assets/playerheads/abc.png");
    image.onerror();
    assert.match(image.src, /^data:image\/svg\+xml,/);
    assert.equal(image.onerror, null);
    adapter.setPlayerVitals(1, { health: 17, maxHealth: 20 });
    const vitals = head.element.querySelector(".history-player-vitals");
    assert.equal(vitals.hidden, false);
    assert.equal(vitals.querySelector(".history-health-hearts").children.length, 10);
    assert.equal(vitals.children.length, 1, "historical marker renders hearts only");
    head.element.onfocus();
    assert.match(adapter.tooltip.textContent, /Test player/);
    head.element.onblur();
    assert.equal(adapter.tooltip.hidden, true);
    let sought: number | undefined;
    adapter.setEvents(
      [
        {
          point,
          type: "DEATH",
          payload: JSON.stringify({
            message: "Test player hit the ground too hard",
            from: point,
            to: point,
          }),
        },
      ],
      names,
      (time) => (sought = time),
      { players: [{ id: 1, uuid: "abc" }] },
    );
    const event = adapter.events.children[0];
    assert.equal(event.element.textContent, "");
    assert.equal(event.element.children.length, 1);
    assert.equal(event.element.style.color, eventColor("DEATH"));
    assert.equal(event.element.style.borderColor, playerColor(1));
    event.offsetX = 48;
    event.offsetY = -48;
    event.element.style.translate = "48px -48px";
    adapter.layoutEvents();
    assert.equal(event.offsetX, 0, "event marker remains anchored to its trail coordinate");
    assert.equal(event.offsetY, 0, "event marker remains anchored to its trail coordinate");
    assert.equal(event.element.style.translate, "0px 0px");
    adapter.setEvents(
      [
        {
          point,
          type: "DEATH",
          payload: JSON.stringify({
            message: "Test player hit the ground too hard",
            from: point,
            to: point,
          }),
        },
      ],
      names,
      (time) => (sought = time),
      { players: [{ id: 1, uuid: "abc" }] },
    );
    assert.equal(
      adapter.events.children[0],
      event,
      "retains existing markers without restarting entrance animations",
    );
    event.element.onfocus();
    assert.match(adapter.tooltip.textContent, /death/);
    assert.match(adapter.tooltip.textContent, /hit the ground too hard/);
    assert.doesNotMatch(adapter.tooltip.textContent, /Position|From:|To:/);
    assert.match(adapter.tooltip.style.backgroundImage, /playerheads\/abc\.png/);
    event.element.onclick();
    assert.equal(sought, undefined, "event clicks do not seek");
    adapter.tooltip.hidden = false;
    adapter.setTrails([[point, { ...point, x: 320, time: 11000 }]], names);
    assert.equal(adapter.tooltip.hidden, false, "overlay refresh preserves tooltip");
    const line = adapter.trails.children[0].line;
    adapter.raycaster.hits = [{ object: line, faceIndex: 0, pointOnLine: { x: 5, y: 0, z: 0 } }];
    adapter.hover({ target: new Element(), clientX: 50, clientY: 50 });
    assert.equal(adapter.hoverDot.element.hidden, false);
    assert.equal(adapter.hoverDot.position.x, 5);
    assert.equal(adapter.hoverState[1], 6000);
    assert.equal(adapter.hoverDot.element.style.background, playerColor(1));
    adapter.raycaster.hits = [];
    adapter.hover({ target: new Element(), clientX: 50, clientY: 50 });
    assert.equal(adapter.hoverDot.element.hidden, true);
    assert.equal(adapter.tooltip.hidden, true);
    adapter.setEvents(
      [{ point, type: "CHAT", payload: JSON.stringify({ message: "<b>Hello</b>" }) }],
      names,
      undefined,
      { players: [{ id: 1, uuid: "abc" }] },
    );
    const bubble = adapter.events.children[0].element;
    assert.equal(
      bubble.dataset.historyTooltip,
      undefined,
      "chat bubbles have no redundant tooltip",
    );
    assert.equal(bubble.children.length, 2, "chat bubble includes a player head and message");
    assert.equal(bubble.children[0].src, "maps/world/assets/playerheads/abc.png");
    assert.match(bubble.children[1].children[0].textContent, /Test player · \d{2}:\d{2}:\d{2}/);
    assert.equal(bubble.children[1].children[1].textContent, "<b>Hello</b>");
    assert.match(bubble.className, /history-chat-bubble/);
    adapter.dispose();
  } finally {
    for (const key of keys) {
      if (old[key] === undefined) delete globalThis[key];
      else globalThis[key] = old[key];
    }
  }
});
