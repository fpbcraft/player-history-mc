import assert from "node:assert/strict";
import { test } from "vitest";
import {
  dayFraction,
  formatMinecraftTime,
  minecraftDay,
  sampledDayTime,
} from "../src/world-status.js";

test("Minecraft ticks format using the in-game clock convention", () => {
  assert.equal(formatMinecraftTime(0), "06:00");
  assert.equal(formatMinecraftTime(6_000), "12:00");
  assert.equal(formatMinecraftTime(12_000), "18:00");
  assert.equal(formatMinecraftTime(18_000), "00:00");
  assert.equal(formatMinecraftTime(24_000), "06:00");
  assert.equal(minecraftDay(0), 1);
  assert.equal(minecraftDay(24_000), 2);
});

test("live world time advances between samples unless daylight cycle is frozen", () => {
  const live = { dayTime: 100, daylightCycle: true, hasSkyLight: true };
  const frozen = { dayTime: 100, daylightCycle: false, hasSkyLight: true };
  assert.equal(sampledDayTime(live, 1_000, 2_000), 120);
  assert.equal(sampledDayTime(frozen, 1_000, 2_000), 100);
  assert.equal(sampledDayTime(undefined, 1_000, 2_000), null);
});

test("lighting interpolation preserves day, dusk, night and dawn", () => {
  assert.equal(dayFraction(6_000), 1);
  assert.equal(dayFraction(12_500), 0.5);
  assert.equal(dayFraction(18_000), 0);
  assert.equal(dayFraction(23_500), 0.5);
});
