// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  PlayerRoster,
  rosterPlayers,
  rosterHealth,
  rosterSeen,
  createRosterHead,
} from "../src/player-roster.js";
const rosters: PlayerRoster[] = [];
afterEach(() => {
  for (const roster of rosters.splice(0)) roster.dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const point = {
  player: 1,
  time: new Date(2026, 10, 10, 20, 47, 56).getTime(),
  world: 2,
  x: 32,
  y: 2048,
  z: 0,
  flags: 0,
};
const registry = {
  players: [{ id: 1, uuid: "abc", name: "VeryLongPlayerName" }],
  worlds: [{ id: 2, key: "minecraft:the_nether" }],
  items: [],
};
const fixture = (hover: boolean, offline = false) => {
  vi.stubGlobal("matchMedia", () => ({ matches: hover }));
  const root = document.createElement("div");
  document.body.append(root);
  root.getBoundingClientRect = () => new DOMRect(0, 0, 400, 80);
  const select = vi.fn();
  const roster = new PlayerRoster(root, select);
  rosters.push(roster);
  const rows = rosterPlayers(
    [point],
    registry,
    { 1: { health: 17, maxHealth: 20, sneaking: true } },
    offline,
  );
  roster.update(rows);
  const button = root.querySelector("button");
  if (!button) throw new Error("Missing player");
  button.getBoundingClientRect = () => new DOMRect(10, 10, 90, 56);
  const details = document.querySelector<HTMLElement>(".history-roster-details");
  if (!details) throw new Error("Missing details");
  return { root, roster, button, details, select, rows };
};
it("starts collapsed, expands without following, and uses unpinned desktop hover details", () => {
  const { root, button, details, select } = fixture(true);
  expect(root.dataset.expanded).toBe("false");
  button.dispatchEvent(new MouseEvent("mouseenter"));
  expect(details.hidden).toBe(true);
  button.click();
  expect(root.dataset.expanded).toBe("true");
  expect(select).not.toHaveBeenCalled();
  expect(button.textContent).toBe("VeryLongPlayerName");
  button.dispatchEvent(new MouseEvent("mouseenter"));
  expect(details.textContent).toBe("17 / 20 HP");
  button.click();
  expect(select).toHaveBeenCalledOnce();
  button.dispatchEvent(new MouseEvent("mouseleave"));
  expect(details.hidden).toBe(true);
  expect(details.textContent).not.toMatch(/VeryLong|Nether|Online|Sneaking/);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(root.dataset.expanded).toBe("false");
});
it("uses touch details on mobile and ignores synthetic mouse hover", () => {
  const { root, button, details } = fixture(false);
  root.click();
  button.dispatchEvent(new MouseEvent("mouseenter"));
  expect(details.hidden).toBe(true);
  const touch = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(touch, "pointerType", { value: "touch" });
  button.dispatchEvent(touch);
  button.click();
  expect(details.hidden).toBe(false);
  expect(details.textContent).toBe("17 / 20 HP");
  button.dispatchEvent(new MouseEvent("mouseleave"));
  expect(details.hidden).toBe(false);
  document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(details.hidden).toBe(true);
  expect(root.dataset.expanded).toBe("false");
});
it("shows only a compact seen time for offline players and retains head DOM on health changes", () => {
  const { root, roster, button, details, rows } = fixture(true, true);
  root.click();
  button.dispatchEvent(new MouseEvent("mouseenter"));
  expect(details.textContent).toMatch(/^Seen /);
  expect(details.textContent).not.toMatch(/VeryLong|Nether|Offline|HP|PM/);
  const face = button.querySelector(".history-roster-face");
  const row = rows[0];
  if (!row) throw new Error("Missing row");
  roster.update([{ ...row, point: { ...point, x: 400 } }]);
  expect(button.querySelector(".history-roster-face")).toBe(face);
  roster.update([]);
  expect(root.children).toHaveLength(0);
  expect(details.hidden).toBe(true);
});
it("formats seen timestamps without seconds and omits today's redundant date", () => {
  expect(rosterSeen(point.time, point.time)).toBe("Seen 20:47");
  expect(rosterSeen(point.time, point.time + 86400000)).toContain("20:47");
  expect(rosterSeen(point.time, point.time + 86400000).length).toBeLessThan(24);
});
it("uses a single head fallback attempt and labels unknown health honestly", () => {
  const head = createRosterHead("abc");
  const image = head.querySelector("img");
  if (!image) throw new Error("Missing head");
  image.dispatchEvent(new Event("error"));
  expect(image.onerror).toBeNull();
  expect(head.className).toContain("fallback");
  expect(rosterHealth({ health: 2 })).toBe("HP unknown");
  expect(rosterHealth({ health: Number.NaN, maxHealth: 20 })).toBe("HP unknown");
});
