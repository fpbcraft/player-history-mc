import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { BlueMap3DReplayAdapter } from "../src/bluemap3d-replay-adapter.js";
import type { BlueMapRuntime, Object3D, Position3, Quaternion3 } from "../src/bluemap-types.js";

class FakePosition implements Position3 {
  x = 0;
  y = 0;
  z = 0;
  set(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

class FakeQuaternion implements Quaternion3 {
  values: [number, number, number, number] = [0, 0, 0, 1];
  set(x: number, y: number, z: number, w: number): Quaternion3 {
    this.values = [x, y, z, w];
    return this;
  }
}

class FakeObject implements Object3D {
  readonly position = new FakePosition();
  readonly quaternion = new FakeQuaternion();
  visible = true;
  name = "";
  userData: Record<string, unknown> = {};
  parent?: { remove(child: Object3D): void };
  children: Object3D[] = [];

  add(...children: Object3D[]): void {
    for (const child of children) {
      this.children.push(child);
      child.parent = this;
    }
  }

  remove(child: Object3D): void {
    this.children = this.children.filter((candidate) => candidate !== child);
    if (child.parent === this) delete child.parent;
  }

  clone(recursive = true): Object3D {
    const copy = new FakeObject();
    copy.visible = this.visible;
    copy.name = this.name;
    copy.position.set(this.position.x ?? 0, this.position.y ?? 0, this.position.z ?? 0);
    copy.quaternion.set(...this.quaternion.values);
    if (recursive)
      for (const child of this.children) copy.add(child.clone(true));
    return copy;
  }
}

const runtime = (): BlueMapRuntime =>
  ({
    Three: {
      Group: FakeObject,
    },
  }) as unknown as BlueMapRuntime;

afterEach(() => {
  delete window.__bluemap3d;
});

test("historical object replay clones the live mesh and suppresses the present-day copy", () => {
  const root = new FakeObject();
  const source = new FakeObject();
  window.__bluemap3d = {
    root,
    objects: {
      "create_contraptions/train/0": {
        mesh: source,
        meshUrl: "assets/bluemap3d/meshes/create/train_0-v5-7.bm3d",
      },
    },
  };

  const adapter = new BlueMap3DReplayAdapter(runtime());
  const stats = adapter.setObjects(
    [
      {
        object: 3,
        time: 1000,
        world: 0,
        x: 12.5,
        y: 70,
        z: -4,
        qx: 0,
        qy: Math.SQRT1_2,
        qz: 0,
        qw: Math.SQRT1_2,
        geometry: 7,
      },
    ],
    [
      {
        id: 3,
        provider: "create_contraptions",
        sourceId: "train/0",
        label: "Carriage",
      },
    ],
  );

  assert.deepEqual(stats, { rendered: 1, unavailable: 0, geometryMismatch: 0 });
  assert.equal(source.visible, false);
  assert.equal(root.children.length, 1);
  const historyRoot = root.children[0] as FakeObject;
  assert.equal(historyRoot.children.length, 1);
  const clone = historyRoot.children[0] as FakeObject;
  assert.equal(clone.position.x, 12.5);
  assert.equal(clone.position.y, 70);
  assert.equal(clone.position.z, -4);
  assert.deepEqual(clone.quaternion.values, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);

  adapter.clear();
  assert.equal(source.visible, true);
  assert.equal(historyRoot.children.length, 0);
});

test("historical renderer reports unavailable and mismatched current geometry", () => {
  const root = new FakeObject();
  const source = new FakeObject();
  window.__bluemap3d = {
    root,
    objects: {
      "sable_ships/ship": {
        mesh: source,
        meshUrl: "assets/bluemap3d/meshes/sable/ship-v5-99.bm3d",
      },
    },
  };

  const adapter = new BlueMap3DReplayAdapter(runtime());
  const stats = adapter.setObjects(
    [
      {
        object: 1,
        time: 1000,
        world: 0,
        x: 0,
        y: 0,
        z: 0,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        geometry: 42,
      },
      {
        object: 2,
        time: 1000,
        world: 0,
        x: 0,
        y: 0,
        z: 0,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        geometry: 1,
      },
    ],
    [
      { id: 1, provider: "sable_ships", sourceId: "ship", label: "Ship" },
      { id: 2, provider: "sable_ships", sourceId: "gone", label: "Gone" },
    ],
  );

  assert.deepEqual(stats, { rendered: 1, unavailable: 1, geometryMismatch: 1 });
});
