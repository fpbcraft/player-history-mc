import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { geometryStem, ObjectGeometryCatalog } from "../src/object-geometry-catalog.js";
import { ObjectReplaySession } from "../src/object-replay-session.js";

const identity = { provider: "sable_ships", sourceId: "ship/é", version: 8491740861048744 };
const stem = `geometry/${createHash("sha256").update(`${identity.provider}\0${identity.sourceId}\0${identity.version}`).digest("hex")}`;
const entry = {
  ...identity,
  mesh: `${stem}.dspr`,
  atlas: `${stem}.png`,
  lastReferencedAt: 0,
};
afterEach(() => vi.unstubAllGlobals());

it("uses the archive's UTF-8 SHA-256 key, including exact 53-bit versions", async () => {
  vi.stubGlobal("crypto", undefined); // Plain HTTP LAN maps have no Web Crypto.
  const digest = createHash("sha256")
    .update(`${identity.provider}\0${identity.sourceId}\0${identity.version}`)
    .digest("hex");
  expect(await geometryStem(identity)).toBe(`geometry/${digest}`);
});

it("loads only visible versions, coalesces requests, and reuses geometry paths across seeks", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null));
  const catalog = new ObjectGeometryCatalog(
    "https://example.test/player-history/data/objects",
    fetcher,
  );
  catalog.request([identity, identity]);
  await vi.waitFor(() => expect(catalog.geometries).toEqual([entry]));
  catalog.request([identity]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `https://example.test/player-history/data/objects/${await geometryStem(identity)}.dspr`,
  );
  catalog.clear();
});

it("bounds concurrent loads and backs off unavailable archives without retrying every frame", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(null, { status: 503 }));
  const catalog = new ObjectGeometryCatalog("https://example.test/objects", fetcher);
  catalog.request(Array.from({ length: 100 }, (_, version) => ({ ...identity, version })));
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  await new Promise((resolve) => setTimeout(resolve, 20));
  catalog.request(Array.from({ length: 4 }, (_, version) => ({ ...identity, version })));
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(catalog.geometries).toEqual([]);
  catalog.clear();
});

it("uses legacy BM3D archives when no Diorama sprite exists", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null));
  const catalog = new ObjectGeometryCatalog("https://example.test/objects", fetcher);
  catalog.request([identity]);
  await vi.waitFor(() => expect(catalog.geometries).toEqual([{ ...entry, mesh: `${stem}.bm3d` }]));
  expect(fetcher.mock.calls.every(([, options]) => options?.method === "HEAD")).toBe(true);
  catalog.clear();
});

it("does not apply a completed lookup after clearing the recorder/viewer session", async () => {
  let complete!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const catalog = new ObjectGeometryCatalog("https://example.test/objects", fetcher);
  catalog.request([identity]);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  catalog.clear();
  complete(new Response(null));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(catalog.geometries).toEqual([]);
});

it("hydrates a compact replay manifest at the cursor and keeps legacy inline catalogs working", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockImplementation(async () => new Response(null)),
  );
  const session = new ObjectReplaySession("https://example.test/objects", (_base, duration) => ({
    duration,
    setAvailableRanges() {},
    clear() {},
    async window() {
      return [
        {
          object: 0,
          time: 1000,
          world: 0,
          x: 32,
          y: 2048,
          z: 0,
          qx: 0,
          qy: 0,
          qz: 0,
          qw: 32767,
          sx: 1024,
          sy: 1024,
          sz: 1024,
          geometry: identity.version,
          flags: 0,
        },
      ];
    },
  }));
  const manifest = {
    protocolVersion: 3 as const,
    earliestTimestamp: 1000,
    latestTimestamp: 2000,
    chunkDurationMs: 60000,
    positionScale: 32,
    quaternionScale: 32767,
    scaleScale: 1024,
    geometryArchive: true,
    geometryLookup: "sha256-v1" as const,
    geometries: [],
    registry: {
      objects: [{ id: 0, ...identity, label: "Sable ship" }],
      worlds: ["minecraft:overworld"],
    },
  };
  session.configure(manifest);
  session.applyWindow(await session.window(1500));
  expect(session.frame(1500, "minecraft:overworld")?.poses[0]?.x).toBe(1);
  await vi.waitFor(() =>
    expect(session.frame(1500, "minecraft:overworld")?.geometries).toEqual([entry]),
  );
  session.configure({ ...manifest, geometryLookup: undefined, geometries: [entry] });
  expect(session.frame(1500, "minecraft:overworld")?.geometries).toEqual([entry]);
  session.clear();
});
