// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReplayPanel } from "../src/replay-panel.js";

const { playerCalls, rosterCalls, offlineCalls } = vi.hoisted(() => ({
  playerCalls: vi.fn(),
  rosterCalls: vi.fn(),
  offlineCalls: vi.fn(),
}));
vi.mock("../src/bluemap-adapter.js", async (original) => ({
  ...(await original()),
  BlueMapAdapter: class {
    mapId = "world";
    setPlayers = playerCalls;
    setRoster = rosterCalls;
    setOfflineLocations = offlineCalls;
    setPlayerVitals() {}
    layoutEvents() {}
    dispose() {}
  },
}));

vi.mock("../src/history-runtime-loader.js", async () => {
  const runtime = await import("../src/history-runtime.js");
  return { loadHistoryRuntime: () => Promise.resolve(runtime) };
});

customElements.define("test-live-replay", ReplayPanel);
const registry = {
  players: [{ id: 1, uuid: "00000000-0000-0000-0000-000000000001", name: "Player" }],
  worlds: [{ id: 0, key: "minecraft:overworld" }],
  items: [],
};
let panel: ReplayPanel;
let fetcher: ReturnType<typeof vi.fn>;
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  playerCalls.mockClear();
  rosterCalls.mockClear();
  offlineCalls.mockClear();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  fetcher = vi.fn(async (input) => {
    const url = String(input);
    if (url.includes("integration.json"))
      return Response.json({ mapWorlds: { world: "minecraft:overworld" } });
    if (url.includes("presence.json") || url.includes("data/live.json"))
      return Response.json({
        protocolVersion: 2,
        generatedAt: Date.now(),
        registry,
        points: [{ player: 1, time: Date.now(), world: 0, x: 32, y: 64 * 32, z: 0, flags: 0 }],
        events: [],
        states: {},
      });
    if (url.includes("/pair")) return Response.json({ code: "ABC123", token: "browser-secret" });
    if (url.includes("/session")) return Response.json({ linked: false });
    if (url.includes("/messages")) return Response.json({ messages: [] });
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal("fetch", fetcher);
  panel = document.createElement("test-live-replay") as ReplayPanel;
});
afterEach(() => {
  panel.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("renders live players without requesting a historical manifest", async () => {
  document.body.append(panel);
  await flush();
  expect(fetcher.mock.calls.some(([url]) => String(url).includes("manifest.json"))).toBe(false);
  expect(playerCalls).toHaveBeenCalled();
  expect(playerCalls.mock.calls.at(-1)?.[0][0]).toMatchObject({ player: 1, world: 0 });
});

it("a hung history refresh cannot hold live requests or visible avatars", async () => {
  localStorage.setItem("player-history-open", "true");
  document.body.append(panel);
  await flush();
  expect(fetcher.mock.calls.some(([url]) => String(url).includes("manifest.json"))).toBe(true);
  expect(playerCalls.mock.calls.at(-1)?.[0][0]).toMatchObject({ player: 1 });
  await vi.advanceTimersByTimeAsync(2_000);
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes("data/live.json")).length,
  ).toBeGreaterThanOrEqual(2);
});

it("chat receives public messages even if session fails and historical range never finishes", async () => {
  document.body.append(panel);
  await flush();
  vi.spyOn(panel, "loadRangeEvents").mockImplementation(() => new Promise(() => {}));
  const original = fetcher.getMockImplementation();
  fetcher.mockImplementation((input, options) =>
    String(input).includes("/session")
      ? Promise.reject(new Error("Session unavailable"))
      : original(input, options),
  );
  await panel.openChat();
  await flush();
  expect(fetcher.mock.calls.some(([url]) => String(url).includes("/messages"))).toBe(true);
  panel.close();
  const before = fetcher.mock.calls.filter(([url]) => String(url).includes("/messages")).length;
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/messages"))).toHaveLength(
    before + 1,
  );
  expect(panel.querySelector<HTMLElement>(".history-chat-panel")?.hidden).toBe(false);
});

it("closing historical mode restores live on every subsequent frame", async () => {
  document.body.append(panel);
  await flush();
  const state = panel as unknown as {
    isLive: boolean;
    objectAdapter: { clear(): void };
    tickFrame(t: number): void;
  };
  state.isLive = false;
  const clear = vi.fn();
  state.objectAdapter = { clear, dispose() {} };
  panel.close();
  state.tickFrame(16);
  state.tickFrame(32);
  expect(state.isLive).toBe(true);
  expect(clear).toHaveBeenCalled();
  expect(playerCalls.mock.calls.at(-1)?.[3]).toBe(true);
});

it("paints the activity summary before a blocked object-history manifest", async () => {
  const original = fetcher.getMockImplementation();
  fetcher.mockImplementation((input, options) => {
    const url = String(input);
    if (url.endsWith("data/manifest.json"))
      return Promise.resolve(
        Response.json({
          protocolVersion: 2,
          earliestTimestamp: Date.now() - 3_600_000,
          latestTimestamp: Date.now(),
          chunkDurationMs: 300_000,
          capabilities: {},
          trackingEnabled: {},
          registry,
          activityBucketMs: 60_000,
          activityReady: true,
        }),
      );
    if (url.includes("/activity/"))
      return Promise.resolve(Response.json([[Date.now() - 60_000, 10]]));
    return original(input, options);
  });
  localStorage.setItem("player-history-open", "true");
  document.body.append(panel);
  await flush();
  expect(fetcher.mock.calls.some(([url]) => String(url).includes("objects/manifest.json"))).toBe(
    true,
  );
  await vi.waitFor(() =>
    expect(panel.querySelector(".history-histogram")?.getAttribute("aria-label")).toContain(
      "samples across",
    ),
  );
  expect(playerCalls.mock.calls.at(-1)?.[0][0]).toMatchObject({ player: 1 });
});

it("composes playback once per animation step", async () => {
  document.body.append(panel);
  await flush();
  const state = panel as unknown as {
    manifest: object;
    cache: object;
    clock: { refresh(a: number, b: number): void; isPlaying: boolean };
    tickFrame(t: number): void;
  };
  state.manifest = { registry, earliestTimestamp: 1, latestTimestamp: Date.now() };
  state.cache = { duration: 300_000, clear() {} };
  state.clock.refresh(1, Date.now());
  state.clock.isPlaying = true;
  const render = vi.spyOn(panel, "render").mockImplementation(() => {});
  vi.spyOn(panel, "updateOverlays").mockImplementation(() => {});
  state.tickFrame(16);
  expect(render).toHaveBeenCalledTimes(1);
});

it("a pending account request does not slow public-message polling", async () => {
  const original = fetcher.getMockImplementation();
  fetcher.mockImplementation((input, options) =>
    String(input).includes("/session") ? new Promise<Response>(() => {}) : original(input, options),
  );
  document.body.append(panel);
  await flush();
  void panel.openChat();
  await flush();
  await vi.advanceTimersByTimeAsync(4_000);
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/messages"))).toHaveLength(3);
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/session"))).toHaveLength(1);
});

it("keeps foreign-dimension roster cards separate from map players and hides offline locations during replay", async () => {
  const original = fetcher.getMockImplementation();
  fetcher.mockImplementation((input, options) => {
    if (String(input).includes("presence.json"))
      return Promise.resolve(
        Response.json({
          protocolVersion: 2,
          generatedAt: Date.now(),
          registry: {
            players: [
              ...registry.players,
              { id: 2, uuid: "nether", name: "Nether player" },
              { id: 3, uuid: "offline", name: "Offline player" },
            ],
            worlds: [...registry.worlds, { id: 1, key: "minecraft:the_nether" }],
            items: [],
          },
          points: [1, 2].map((player) => ({
            player,
            world: player - 1,
            time: Date.now(),
            x: 32,
            y: 2048,
            z: 0,
            flags: 0,
          })),
          lastLocations: [
            { player: 3, world: 0, time: Date.now() - 10000, x: 64, y: 2048, z: 0, flags: 2 },
          ],
          events: [],
          states: {},
        }),
      );
    return original(input, options);
  });
  document.body.append(panel);
  await flush();
  expect(playerCalls.mock.calls.at(-1)?.[0].map((point) => point.player)).toEqual([1]);
  expect(rosterCalls.mock.calls.at(-1)?.[0].map((row) => row.point.player)).toEqual([1, 2, 3]);
  expect(offlineCalls.mock.calls.at(-1)?.[0].map((row) => row.point.player)).toEqual([3]);
  (panel as unknown as { isLive: boolean }).isLive = false;
  panel.render();
  expect(offlineCalls.mock.calls.at(-1)?.[0]).toEqual([]);
  expect(rosterCalls.mock.calls.at(-1)?.[0]).toEqual([]);
});

it("keeps the pairing command through chat polls and copies the full command", async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  const withClipboard = Object.create(navigator);
  Object.defineProperty(withClipboard, "clipboard", { value: { writeText: copy } });
  vi.stubGlobal("navigator", withClipboard);
  document.body.append(panel);
  await flush();
  await panel.openChat();
  panel.querySelector<HTMLButtonElement>('[name="chat-connect"]')?.click();
  await flush();
  const pairing = panel.querySelector<HTMLElement>(".history-chat-pairing");
  expect(pairing?.hidden).toBe(false);
  expect(panel.querySelector('[data-control="chat-pair-command"]')?.textContent).toBe(
    "/webchat link ABC123",
  );
  await vi.advanceTimersByTimeAsync(10_000);
  expect(pairing?.hidden).toBe(false);
  panel.querySelector<HTMLButtonElement>('[name="chat-copy"]')?.click();
  await flush();
  expect(copy).toHaveBeenCalledWith("/webchat link ABC123");
  expect(panel.querySelector('[name="chat-copy-status"]')?.textContent).toBe("Copied!");
  vi.spyOn(panel, "pollLive").mockResolvedValue(undefined);
  vi.spyOn(panel, "pollChat").mockResolvedValue(undefined);
  await vi.advanceTimersByTimeAsync(290_000);
  expect(pairing?.hidden).toBe(true);
  expect(panel.querySelector('[data-control="chat-pair-command"]')?.textContent).toBe("");
});

it("clears pairing after linking and retains a selectable command if clipboard is denied", async () => {
  const withClipboard = Object.create(navigator);
  Object.defineProperty(withClipboard, "clipboard", {
    value: { writeText: vi.fn().mockRejectedValue(Error("denied")) },
  });
  vi.stubGlobal("navigator", withClipboard);
  document.body.append(panel);
  await flush();
  await panel.openChat();
  panel.querySelector<HTMLButtonElement>('[name="chat-connect"]')?.click();
  await flush();
  panel.querySelector<HTMLButtonElement>('[name="chat-copy"]')?.click();
  await flush();
  expect(panel.querySelector<HTMLElement>(".history-chat-pairing")?.hidden).toBe(false);
  expect(window.getSelection()?.toString()).toBe("/webchat link ABC123");
  expect(panel.querySelector('[name="chat-copy-status"]')?.textContent).toContain(
    "Select and copy",
  );
  const previous = fetcher.getMockImplementation();
  fetcher.mockImplementation(async (input, ...args) =>
    String(input).includes("/session")
      ? Response.json({ linked: true, name: "Player" })
      : previous?.(input, ...args),
  );
  await vi.advanceTimersByTimeAsync(2_000);
  expect(panel.querySelector<HTMLElement>(".history-chat-pairing")?.hidden).toBe(true);
  expect(panel.querySelector('[data-control="chat-pair-command"]')?.textContent).toBe("");
});
