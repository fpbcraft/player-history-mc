import { describe, expect, it } from "vitest";
import { chatEventsBetween } from "../src/event-notifications.js";
import type { HistoryEvent } from "../src/types.js";

const event = (time: number, type = "CHAT", player = 1): HistoryEvent => ({
  point: { player, time, world: 0, x: 0, y: 0, z: 0, flags: 0 },
  type,
  payload: { message: String(time) },
});

describe("playback chat notifications", () => {
  it("finds selected chat messages crossed by the replay clock", () => {
    const events = [event(10), event(20, "DEATH"), event(30, "CHAT", 2), event(40)];

    expect(chatEventsBetween(events, 10, 40, new Set([1])).map((item) => item.point.time)).toEqual([
      40,
    ]);
  });

  it("returns no notifications when playback does not advance", () => {
    expect(chatEventsBetween([event(10)], 10, 10, new Set([1]))).toEqual([]);
  });
});
