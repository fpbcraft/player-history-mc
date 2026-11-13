import { expect, it } from "vitest";
import { VehicleMotion } from "../src/vehicle-motion.js";
import type { VehiclePose } from "../src/vehicle-scene.js";
const pose = (x: number, extra: Partial<VehiclePose> = {}): VehiclePose => ({
  id: "ship",
  dimension: "minecraft:overworld",
  label: "Ship",
  pos: [x, 80, 0],
  rot: [0, 0, 0, 1],
  scale: [1, 1, 1],
  mesh: "ship.dspr",
  ...extra,
});
it("continues smoothly from the displayed pose on early arrivals", () => {
  const motion = new VehicleMotion();
  motion.update(1000, [pose(0)], 0, 100);
  motion.update(1100, [pose(10)], 100, 100);
  expect(motion.sample(150)[0]?.pos[0]).toBe(5);
  motion.update(1200, [pose(20)], 150, 100);
  expect(motion.sample(150)[0]?.pos[0]).toBe(5);
  expect(motion.sample(200)[0]?.pos[0]).toBe(12.5);
});
it("does not restart interpolation for duplicates or accept out of order snapshots", () => {
  const motion = new VehicleMotion();
  motion.update(1000, [pose(0)], 0, 100);
  motion.update(1100, [pose(10)], 100, 100);
  motion.update(1100, [pose(10, { mesh: "replacement.dspr" })], 150, 100);
  expect(motion.sample(175)[0]?.pos[0]).toBe(7.5);
  expect(motion.sample(175)[0]?.mesh).toBe("replacement.dspr");
  motion.update(1000, [pose(-10)], 180, 100);
  expect(motion.sample(200)[0]?.pos[0]).toBe(10);
});
it("snaps teleports, dimensions, and reduced motion without extrapolating stale poses", () => {
  const motion = new VehicleMotion();
  motion.update(1000, [pose(0)], 0, 100);
  motion.update(1100, [pose(500)], 100, 100);
  expect(motion.sample(100)[0]?.pos[0]).toBe(500);
  motion.update(1200, [pose(510)], 200, 100);
  expect(motion.sample(200, true)[0]?.pos[0]).toBe(510);
  expect(motion.sample(100000)[0]?.pos[0]).toBe(510);
  motion.update(1300, [pose(520, { dimension: "minecraft:the_nether" })], 300, 100);
  expect(motion.sample(300)[0]?.pos[0]).toBe(520);
});
