import { sha256 } from "@noble/hashes/sha2.js";
import type { ObjectGeometryEntry } from "./types.js";

export interface GeometryIdentity {
  provider: string;
  sourceId: string;
  version: number;
}

export const geometryStem = (identity: GeometryIdentity): string => {
  const key = `${identity.provider}\0${identity.sourceId}\0${identity.version}`;
  const hash = sha256(new TextEncoder().encode(key));
  const stem = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `geometry/${stem}`;
};

/** Fetch only geometry versions visible at the replay cursor; keep seeks and failures bounded. */
export class ObjectGeometryCatalog {
  private readonly entries = new Map<string, ObjectGeometryEntry>();
  private readonly pending = new Set<string>();
  private readonly retries = new Map<string, number>();
  private controller = new AbortController();
  geometries: ObjectGeometryEntry[] = [];

  constructor(
    private readonly base: string,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  request(identities: GeometryIdentity[]): void {
    for (const identity of identities) {
      const key = JSON.stringify(identity);
      const entry = this.entries.get(key);
      if (entry) {
        this.entries.delete(key);
        this.entries.set(key, entry);
        continue;
      }
      if (this.pending.has(key) || (this.retries.get(key) ?? 0) > Date.now()) continue;
      if (this.pending.size >= 4) break;
      this.pending.add(key);
      void this.load(identity, key, this.controller);
    }
  }

  private async load(
    identity: GeometryIdentity,
    key: string,
    controller: AbortController,
  ): Promise<void> {
    try {
      const stem = geometryStem(identity);
      if (controller.signal.aborted) return;
      const options: RequestInit = {
        method: "HEAD",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        cache: "no-cache",
      };
      const base = this.base.replace(/\/$/, "");
      let mesh = `${stem}.dspr`;
      let response = await this.fetcher(`${base}/${mesh}`, options);
      if (response.status === 404) {
        mesh = `${stem}.bm3d`;
        response = await this.fetcher(`${base}/${mesh}`, options);
      }
      if (!response.ok) throw Error(`Geometry lookup HTTP ${response.status}`);
      if (controller.signal.aborted) return;
      this.entries.set(key, { ...identity, mesh, atlas: `${stem}.png`, lastReferencedAt: 0 });
      while (this.entries.size > 256) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
      this.retries.delete(key);
      this.geometries = [...this.entries.values()];
    } catch {
      if (!controller.signal.aborted) {
        this.retries.set(key, Date.now() + 5000);
        while (this.retries.size > 256) {
          const oldest = this.retries.keys().next().value;
          if (oldest === undefined) break;
          this.retries.delete(oldest);
        }
      }
    } finally {
      if (this.controller === controller) this.pending.delete(key);
    }
  }

  clear(): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.entries.clear();
    this.pending.clear();
    this.retries.clear();
    this.geometries = [];
  }
}
