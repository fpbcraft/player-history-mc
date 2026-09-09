// @vitest-environment jsdom

import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistoryEvent } from "../src/types.js";
import { renderEventFilter } from "../src/ui/event-filter-view.js";
import { renderHistoryEvents } from "../src/ui/history-events-view.js";
import { renderPlayerFilter } from "../src/ui/player-filter-view.js";

const event: HistoryEvent = {
  point: { player: 1, time: 1_000, world: 0, x: 0, y: 0, z: 0, flags: 0 },
  type: "CHAT",
  payload: { message: "hello" },
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("declarative replay lists", () => {
  it("updates player selection through a typed callback", () => {
    const root = document.createElement("div");
    const onChange = vi.fn();
    renderPlayerFilter(root, {
      names: new Map([[1, "Alex"]]),
      selected: new Set(),
      onChange,
    });
    const input = root.querySelector("input");
    if (input instanceof HTMLInputElement) {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    expect(onChange).toHaveBeenCalledWith(1, true);
    render(null, root);
  });

  it("keeps event filters and replay messages accessible", () => {
    const filters = document.createElement("div");
    const chat = document.createElement("div");
    const ticks = document.createElement("section");
    renderEventFilter(filters, {
      types: new Set(["CHAT"]),
      disabled: new Set(),
      onChange: vi.fn(),
    });
    renderHistoryEvents(chat, ticks, {
      events: [event],
      from: 0,
      to: 2_000,
      timelineWidth: 600,
      names: new Map([[1, "Alex"]]),
      players: [],
      formatTime: (time) => String(time),
      onSelect: vi.fn(),
    });

    expect(filters.querySelector('input[aria-label="chat"]')).not.toBeNull();
    expect(chat.querySelector(".history-chat-row")?.textContent).toContain("hello");
    expect(chat.querySelector(".history-chat-message")?.textContent).toContain("hello");
    expect(ticks.querySelector(".history-timeline-event")).not.toBeNull();
    render(null, filters);
    render(null, chat);
    render(null, ticks);
  });
});
