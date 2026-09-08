import test from "node:test";
import assert from "node:assert/strict";
import {
  BlueMapAdapter,
  playerColor,
  eventColor,
} from "../bluemap-addon/src/bluemap-adapter.js";
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
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 100, width: 100, height: 100 };
  }
  closest(selector) {
    return selector.split(",").some((s) => s.trim() === "." + this.className)
      ? this
      : null;
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
    assert.equal(
      head.element.children[0].src,
      "maps/world/assets/playerheads/abc.png",
    );
    head.element.children[0].onerror();
    assert.match(head.element.children[0].src, /^data:image\/svg\+xml,/);
    assert.equal(head.element.children[0].onerror, null);
    head.element.onfocus();
    assert.match(adapter.tooltip.textContent, /Test player/);
    head.element.onblur();
    assert.equal(adapter.tooltip.hidden, true);
    let sought;
    adapter.setEvents(
      [{ point, type: "DEATH", payload: "{}" }],
      names,
      (time) => (sought = time),
    );
    const event = adapter.events.children[0];
    assert.equal(event.element.textContent, "");
    assert.equal(event.element.children.length, 1);
    assert.equal(event.element.style.color, eventColor("DEATH"));
    assert.equal(event.element.style.borderColor, playerColor(1));
    adapter.setEvents(
      [{ point, type: "DEATH", payload: "{}" }],
      names,
      (time) => (sought = time),
    );
    assert.equal(
      adapter.events.children[0],
      event,
      "retains existing markers without restarting entrance animations",
    );
    event.element.onfocus();
    assert.match(adapter.tooltip.textContent, /death/);
    event.element.onclick();
    assert.equal(sought, undefined, "event clicks do not seek");
    adapter.tooltip.hidden = false;
    adapter.setTrails([[point, { ...point, x: 320, time: 11000 }]], names);
    assert.equal(
      adapter.tooltip.hidden,
      false,
      "overlay refresh preserves tooltip",
    );
    const line = adapter.trails.children[0].line;
    adapter.raycaster.hits = [
      { object: line, faceIndex: 0, pointOnLine: { x: 5, y: 0, z: 0 } },
    ];
    adapter.hover({ target: new Element(), clientX: 50, clientY: 50 });
    assert.equal(adapter.hoverDot.element.hidden, false);
    assert.equal(adapter.hoverDot.position.x, 5);
    assert.equal(adapter.hoverState[1], 6000);
    assert.equal(adapter.hoverDot.element.style.background, playerColor(1));
    adapter.raycaster.hits = [];
    adapter.hover({ target: new Element(), clientX: 50, clientY: 50 });
    assert.equal(adapter.hoverDot.element.hidden, true);
    assert.equal(adapter.tooltip.hidden, true);
    adapter.setEvents([{ point, type: "CHAT", payload: JSON.stringify({message: "<b>Hello</b>"}) }], names);
    const bubble = adapter.events.children[0].element;
    assert.match(bubble.textContent, /\d.*<b>Hello<\/b>/, "timestamped message stays literal text");
    assert.equal(bubble.children.length, 0, "chat uses a message bubble instead of an icon");
    assert.match(bubble.className, /history-chat-bubble/);
    adapter.dispose();
  } finally {
    for (const key of keys) {
      if (old[key] === undefined) delete globalThis[key];
      else globalThis[key] = old[key];
    }
  }
});
