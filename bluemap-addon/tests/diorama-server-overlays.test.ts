// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { DioramaServerOverlays } from "../src/diorama-server-overlays.js";
import type { DioramaApi, DioramaOverlay } from "../src/diorama-api.js";
it("projects flat-world claims at their published reference height and uses shared visibility", async () => {
  const fetcher = vi.fn(async (url: URL) => ({
    ok: true,
    json: async () =>
      String(url).includes("world-status")
        ? { generatedAt: Date.now(), dimensions: {} }
        : {
            version: 2,
            generatedAt: Date.now(),
            dimensions: {
              "minecraft:overworld": {
                referenceY: -60,
                claims: [
                  { x: -1, z: 2, name: "Harbour", owner: "Alex" },
                  { x: 0, z: 2, owner: "Riley", color: 0x112233 },
                ],
              },
            },
          },
  }));
  vi.stubGlobal("fetch", fetcher);
  const events = new EventTarget(),
    screen = vi.fn(() => ({ x: 0, y: 0 })),
    registerVisibility = vi.fn();
  const worldAt = vi.fn(() => ({ x: -0.1, z: 35 }));
  let overlay: DioramaOverlay | undefined;
  const api = {
    events,
    screen,
    registerVisibility,
    visible: (key: string) => key === "claims",
    worldAt,
    getState: () => ({ dimension: "minecraft:overworld" }),
    registerOverlay: (_id: string, row: DioramaOverlay) => {
      overlay = row;
      return { invalidate() {}, remove() {} };
    },
  } as unknown as DioramaApi;
  const controls = new DioramaServerOverlays(api, new URL("https://example.test/player-history/"));
  try {
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ctx = {
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {},
      stroke() {},
    } as unknown as CanvasRenderingContext2D;
    const state = api.getState();
    if (!state) throw Error("Missing fixture state");
    overlay?.draw?.(ctx, state);
    expect(screen).toHaveBeenCalledTimes(8);
    expect(screen.mock.calls.every(([point]) => (point as { y: number }).y === -60)).toBe(true);
    expect(registerVisibility).toHaveBeenCalledWith("claims", "Claims", "layers");
    expect(overlay?.hover?.(15, 30, state)).toEqual({
      name: "Harbour",
      owner: "Alex",
      color: 0x58a96a,
    });
    expect(worldAt).toHaveBeenCalledWith(15, 30, -60);
    worldAt.mockReturnValueOnce({ x: 0.1, z: 35 });
    expect(overlay?.hover?.(16, 30, state)).toEqual({
      name: "Riley",
      owner: "Riley",
      color: 0x112233,
    });
    expect(
      overlay?.hover?.(15, 30, { ...state, dimension: "minecraft:the_nether" }),
    ).toBeUndefined();
    screen.mockClear();
    events.dispatchEvent(
      new CustomEvent("visibility", { detail: { key: "claims", value: false } }),
    );
    overlay?.draw?.(ctx, state);
    expect(screen).not.toHaveBeenCalled();
    expect(overlay?.hover?.(15, 30, state)).toBeUndefined();
  } finally {
    controls.dispose();
    vi.unstubAllGlobals();
  }
});
