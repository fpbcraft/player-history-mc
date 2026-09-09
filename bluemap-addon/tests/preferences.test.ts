// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { preferences } from "../src/preferences.js";

describe("player preferences", () => {
  beforeEach(() => localStorage.clear());

  it("distinguishes a fresh viewer from an explicitly empty player selection", () => {
    expect(preferences.players()).toBeNull();

    preferences.savePlayers([]);

    expect(preferences.players()).toEqual([]);
  });
});
