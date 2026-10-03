import { renderActivityHistogram } from "../../src/ui/activity-histogram-view.js";
import { renderEventFilter } from "../../src/ui/event-filter-view.js";
import { renderPlayerFilter } from "../../src/ui/player-filter-view.js";
import { mountReplayPanelView } from "../../src/ui/replay-panel-view.js";
import { renderWebChatFeed } from "../../src/ui/webchat-feed-view.js";

const requireElement = <T extends Element>(root: ParentNode, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing visual fixture element: ${selector}`);
  return element;
};

const root = document.createElement("bluemap-player-replay");
document.body.append(root);
mountReplayPanelView(root);

const section = requireElement<HTMLElement>(root, "section");
section.hidden = false;
requireElement<HTMLButtonElement>(root, '[name="open"]').hidden = true;

const setText = (selector: string, value: string) => {
  requireElement<HTMLElement>(root, selector).textContent = value;
};

setText('[data-control="start"]', "Sep 30, 08:00");
setText('[data-control="end"]', "Oct 2, 08:00");
setText('[name="current"]', "Oct 1, 14:37");
setText('[data-control="range-label"]', "Last 48 hours");
setText('[data-control="trail-label"]', "5m");
setText('[data-control="player-count"]', "3");
setText(".history-status", "Historical replay · local time");

const timeline = requireElement<HTMLInputElement>(root, '[name="timeline"]');
timeline.max = String(48 * 60 * 60 * 1000);
timeline.value = String(30.6 * 60 * 60 * 1000);
timeline.setAttribute("aria-valuetext", "Oct 1, 14:37");

renderActivityHistogram(requireElement(root, ".history-histogram"), {
  bins: [0, 0, 2, 4, 9, 14, 11, 7, 3, 0, 1, 6, 12, 18, 14, 8, 5, 2, 0, 0, 4, 10, 13, 7],
  from: Date.UTC(2026, 8, 30, 12),
  to: Date.UTC(2026, 9, 2, 12),
  formatTime: (time) => new Date(time).toISOString().slice(0, 16).replace("T", " "),
});

const names = new Map([
  [1, "Alex"],
  [2, "Bee"],
  [3, "Casey"],
]);
renderPlayerFilter(requireElement(root, ".history-player-list"), {
  names,
  selected: new Set([1, 2, 3]),
  onChange: () => {},
});

renderEventFilter(requireElement(root, ".history-event-filter-list"), {
  types: new Set(["DEATH", "CHAT", "TELEPORT", "DIMENSION_CHANGE"]),
  disabled: new Set(["DIMENSION_CHANGE"]),
  onChange: () => {},
});

renderWebChatFeed(requireElement(root, ".history-webchat-feed"), [
  { name: "Alex", message: "Heading back to the station." },
  { name: "Bee", message: "I left supplies by the airship." },
  { web: true, name: "Casey", message: "The replay UI is looking good." },
]);

const rangeButton = requireElement<HTMLButtonElement>(root, '[name="range-button"]');
rangeButton.title = "History range: Last 48 hours";
rangeButton.setAttribute("aria-expanded", "false");

const playersButton = requireElement<HTMLButtonElement>(root, '[name="players"]');
playersButton.title = "Players · 3 selected";

const latest = requireElement<HTMLButtonElement>(root, '[name="latest"]');
latest.setAttribute("aria-pressed", "false");

const scenario = new URLSearchParams(location.search).get("scenario") ?? "default";

const showMenu = (selector: string, triggerSelector: string) => {
  const menu = requireElement<HTMLElement>(root, selector);
  const trigger = requireElement<HTMLElement>(root, triggerSelector);
  menu.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    const bounds = trigger.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(bounds.top - menu.offsetHeight - 8, innerHeight - menu.offsetHeight - 8))}px`;
  });
};

if (scenario === "players") showMenu("#history-players", '[name="players"]');
if (scenario === "range") showMenu(".history-range-popover", '[name="range-button"]');
if (scenario === "speed") showMenu(".history-speed-popover", '[name="speed-button"]');
if (scenario === "trails") showMenu(".history-trails-popover", '[name="trails-button"]');
if (scenario === "events") {
  const details = requireElement<HTMLDetailsElement>(root, ".history-event-control");
  details.open = true;
  showMenu(".history-event-options", ".history-event-control summary");
}
if (scenario === "chat") {
  requireElement<HTMLElement>(root, "#history-chat-panel").hidden = false;
  requireElement<HTMLButtonElement>(root, '[name="webchat"]').hidden = true;
  const status = requireElement<HTMLOutputElement>(root, '[name="chat-status"]');
  status.textContent = "Connected as Alex";
  requireElement<HTMLButtonElement>(root, '[name="chat-connect"]').hidden = true;
  requireElement<HTMLButtonElement>(root, '[name="chat-logout"]').hidden = false;
  requireElement<HTMLFormElement>(root, ".history-chat-form").hidden = false;
}

document.documentElement.dataset.visualReady = "true";
