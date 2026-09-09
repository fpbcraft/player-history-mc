// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountReplayPanelView, unmountReplayPanelView } from "../src/ui/replay-panel-view.js";

describe("replay panel view", () => {
  const root = document.createElement("div");

  afterEach(() => {
    unmountReplayPanelView(root);
  });

  it("declares the final panel structure and accessible controls", () => {
    mountReplayPanelView(root);

    const heading = root.querySelector(".history-heading");
    expect(heading?.querySelector(":scope > .history-header-tools")).not.toBeNull();
    expect(root.querySelector(".history-secondary")).toBeNull();
    expect(root.querySelector(".history-chat-panel .history-chat")).not.toBeNull();
    expect(root.querySelector('[name="webchat"] > svg')).not.toBeNull();
    expect(root.querySelectorAll(".history-speed-popover [data-speed]")).toHaveLength(9);
    expect(root.querySelectorAll(".history-trails-popover [data-trail]")).toHaveLength(8);
    const trailLabels = [
      ...root.querySelectorAll<HTMLButtonElement>(".history-trails-popover [data-trail]"),
    ].map((option) => option.textContent?.trim());
    expect(trailLabels).toEqual(expect.arrayContaining(["30 minutes", "2 hours", "3 hours"]));
    expect(trailLabels).not.toEqual(expect.arrayContaining(["Off", "6 hours", "Full range"]));
    expect(root.querySelector('[data-control="trail-label"]')?.textContent?.trim()).toBe("1m");
    expect(root.querySelector('[data-control="player-count"]')?.textContent?.trim()).toBe("0");
    expect(root.querySelector('[name="timeline"]')?.getAttribute("aria-label")).toBe(
      "Replay timeline",
    );
    expect(root.querySelector('[name="range-button"]')?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(root.querySelector(".history-absolute-range")).not.toBeNull();
    const rangeLabels = [
      ...root.querySelectorAll<HTMLButtonElement>(".history-range-options [data-range]"),
    ].map((option) => option.textContent?.trim());
    expect(rangeLabels).toEqual(expect.arrayContaining(["Last 12 hours", "Today", "Yesterday"]));
    expect(root.querySelector(".history-shuttle")).toBeNull();
    expect(root.querySelector(".history-window-selector")).toBeNull();
    expect(root.querySelector('[name="compact"]')).toBeNull();
    expect(
      [
        ...root.querySelectorAll<HTMLElement>(
          ".history-controls > button, .history-controls > div",
        ),
      ].map((control) => control.getAttribute("name") ?? control.className),
    ).toEqual(["back", "play", "forward", "latest", "history-speed"]);
    expect(root.querySelector('[name="back"] .history-seek-icon text')?.textContent?.trim()).toBe(
      "5",
    );
    const eventOverlay = root.querySelector(".history-events");
    expect(eventOverlay?.tagName).toBe("DIV");
    expect(eventOverlay?.closest("section")).toBe(root.querySelector("#history-transport"));
  });

  it("can be unmounted and mounted again without retaining view nodes", () => {
    mountReplayPanelView(root);
    const firstOpenButton = root.querySelector('[name="open"]');
    unmountReplayPanelView(root);
    mountReplayPanelView(root);

    expect(root.querySelector('[name="open"]')).not.toBe(firstOpenButton);
    expect(root.querySelectorAll('[name="open"]')).toHaveLength(1);
  });
});
