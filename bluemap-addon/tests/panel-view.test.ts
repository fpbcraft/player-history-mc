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
    expect(root.querySelector('[name="timeline"]')?.getAttribute("aria-label")).toBe(
      "Replay timeline",
    );
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
