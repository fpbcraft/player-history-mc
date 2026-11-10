// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  PlayerRoster,
  rosterPlayers,
  rosterHealth,
  rosterAction,
  createRosterHead,
} from "../src/player-roster.js";
const point = { player: 1, time: 1000, world: 2, x: 32, y: 2048, z: 0, flags: 0 };
const registry = {
  players: [{ id: 1, uuid: "abc", name: "Tester" }],
  worlds: [{ id: 2, key: "minecraft:the_nether" }],
  items: [],
};
it("shows global heads, names, health and observed posture actions without replacing unchanged cards", () => {
  const root = document.createElement("div");
  const selected: number[] = [];
  const roster = new PlayerRoster(root, (row) => selected.push(row.point.world));
  const rows = rosterPlayers([point], registry, {
    1: { health: 17, maxHealth: 40, sneaking: true },
  });
  roster.update(rows);
  const button = root.querySelector("button");
  if (!button) throw new Error("Missing roster card");
  expect(button.textContent).toContain("TesterNether17 / 40 HPSneaking");
  expect(button.dataset.dimension).toBe("minecraft:the_nether");
  expect(button.querySelector("img")?.src).toContain("/player-history/skins/abc.png");
  button.click();
  expect(selected).toEqual([2]);
  roster.update(rows);
  expect(root.querySelector("button")).toBe(button);
  const face = button.querySelector(".history-roster-face");
  const row = rows[0];
  if (!row) throw new Error("Missing roster player");
  roster.update([{ ...row, point: { ...point, x: 400 } }]);
  expect(button.querySelector(".history-roster-face")).toBe(face);
});
it("offline locations never present old HP/actions as current and disappear when cleared", () => {
  const root = document.createElement("div");
  const roster = new PlayerRoster(root, () => {});
  roster.update(
    rosterPlayers([point], registry, { 1: { health: 20, maxHealth: 20, sprinting: true } }, true),
  );
  expect(root.textContent).toContain("Offline · last location");
  expect(root.textContent).not.toContain("20 / 20");
  expect(root.textContent).not.toContain("Sprinting");
  expect(root.querySelector("button")?.getAttribute("aria-label")).toContain("View last location");
  roster.update([]);
  expect(root.children).toHaveLength(0);
});
it("uses a single fallback attempt and labels unknown health honestly", () => {
  const head = createRosterHead("abc");
  const image = head.querySelector("img");
  if (!image) throw new Error("Missing head image");
  image.dispatchEvent(new Event("error"));
  expect(image.onerror).toBeNull();
  expect(head.className).toContain("fallback");
  expect(rosterHealth({ health: 2 })).toBe("HP unknown");
  expect(rosterHealth({ health: Number.NaN, maxHealth: 20 })).toBe("HP unknown");
  expect(rosterAction({})).toBe("");
});
