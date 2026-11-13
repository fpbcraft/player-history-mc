// @vitest-environment jsdom
import { expect, it } from "vitest";
import { vehicleMarkers, updateVehiclePin } from "../src/vehicle-markers.js";
import type { VehiclePose } from "../src/vehicle-scene.js";
const car = (id: string, x: number, extra: Partial<VehiclePose> = {}): VehiclePose => ({
  id,
  label: "Copper Express",
  named: true,
  group: "train",
  size: 32,
  dimension: "minecraft:overworld",
  mesh: "train.dspr",
  pos: [x, 70, 0],
  rot: [0, 0, 0, 1],
  scale: [1, 1, 1],
  ...extra,
});
it("collapses named carriages at distant zoom without depending on registry iteration order", () => {
  const rows = [car("b", 20), car("a", 0)];
  expect(vehicleMarkers(rows, 0.5)).toEqual(vehicleMarkers([...rows].reverse(), 0.5));
  expect(vehicleMarkers(rows, 0.5)).toHaveLength(1);
  expect(vehicleMarkers(rows, 0.5)[0]?.pos).toEqual([10, 70, 0]);
  expect(vehicleMarkers(rows, 2)).toHaveLength(2);
});
it("keeps dimensions and unnamed vehicles separate and excludes shadow rows", () => {
  const rows = [
    car("a", 0),
    car("b", 1, { dimension: "minecraft:the_nether" }),
    car("c", 2, { named: false }),
    car("d", 3, { shadow: true }),
  ];
  expect(vehicleMarkers(rows, 0.5)).toHaveLength(3);
});
it("uses text for names and initials, reuses the native pin image, and safely updates renamed vehicles", () => {
  const button = document.createElement("button"),
    row = car("a", 0, {
      label: "<img onerror=alert(1)>",
      icon: "https://example.test/assets/diorama-markers/train.png",
    });
  updateVehiclePin(button, row);
  expect(button.querySelectorAll("img")).toHaveLength(1);
  expect(button.querySelector(".diorama-pin-label")?.textContent).toBe(row.label);
  expect(button.querySelector("img")?.getAttribute("alt")).toBe("");
  updateVehiclePin(button, { ...row, label: "Northern Star" });
  expect(button.querySelectorAll("img")).toHaveLength(1);
  expect(button.querySelector(".diorama-pin-initials")?.textContent).toBe("NS");
});
