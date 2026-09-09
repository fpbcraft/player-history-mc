import {
  parseChatFeed,
  parseChatSession,
  parseIntegration,
  parseLiveSnapshot,
  parseManifest,
} from "./protocol.js";
import type {
  ChatFeed,
  ChatSession,
  Fetcher,
  HistoryManifest,
  IntegrationMapping,
  JsonObject,
  LiveSnapshot,
} from "./types.js";

export class HistoryClient {
  constructor(
    private readonly base: URL,
    private readonly fetcher: Fetcher = (...args) => fetch(...args),
  ) {}

  private async json(path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.fetcher(new URL(path, this.base), {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`History HTTP ${response.status}`);
    if (!response.json) throw new Error("History response is not JSON");
    return response.json();
  }

  async manifest(signal?: AbortSignal): Promise<HistoryManifest> {
    return parseManifest(await this.json("data/manifest.json", signal));
  }

  async integration(signal?: AbortSignal): Promise<IntegrationMapping> {
    return parseIntegration(await this.json("integration.json", signal));
  }

  async live(signal?: AbortSignal): Promise<LiveSnapshot> {
    return parseLiveSnapshot(await this.json(`data/live.json?t=${Date.now()}`, signal));
  }

  async activity(day: number, signal?: AbortSignal): Promise<[number, number][]> {
    const response = await this.fetcher(new URL(`data/activity/${day}.json`, this.base), {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error("Recording density unavailable");
    if (!response.json) throw new Error("Response is not JSON");
    const value: unknown = await response.json();
    if (!Array.isArray(value) || value.length > 1_440) throw new Error("Invalid recording density");
    return value.flatMap((row) =>
      Array.isArray(row) && row.length === 2 && row.every(Number.isFinite)
        ? [[row[0] as number, row[1] as number]]
        : [],
    );
  }

  async heatmap(level: string, time: number, signal?: AbortSignal): Promise<number[][]> {
    const response = await this.fetcher(new URL(`data/heatmap/${level}/${time}.json`, this.base), {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`Heatmap HTTP ${response.status}`);
    if (!response.json) throw new Error("Response is not JSON");
    const value: unknown = await response.json();
    if (!Array.isArray(value)) throw new Error("Invalid heatmap data");
    return value.filter((row): row is number[] => Array.isArray(row) && row.every(Number.isFinite));
  }
}

export interface PairingResponse {
  token: string;
  code: string;
}

export class ChatClient {
  constructor(
    private readonly token: () => string,
    private readonly fetcher: Fetcher = (...args) => fetch(...args),
  ) {}

  private async request(action: string, body: JsonObject = {}): Promise<unknown> {
    const response = await this.fetcher(`/player-history-api/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token()}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.headers?.get("content-type")?.includes("application/json")) {
      throw new Error("Web chat is unavailable. The server needs its chat API proxy configured.");
    }
    if (!response.json) throw new Error("Response is not JSON");
    const value: unknown = await response.json();
    if (!response.ok) {
      const message =
        typeof value === "object" && value && "error" in value
          ? String(value.error)
          : "Web chat unavailable";
      throw new Error(message);
    }
    return value;
  }

  async pair(): Promise<PairingResponse> {
    const value = await this.request("pair");
    if (!value || typeof value !== "object" || !("token" in value) || !("code" in value)) {
      throw new Error("Invalid chat pairing response");
    }
    return { token: String(value.token), code: String(value.code) };
  }

  async session(): Promise<ChatSession> {
    return parseChatSession(await this.request("session"));
  }

  async logout(): Promise<void> {
    await this.request("logout");
  }

  async send(message: string): Promise<void> {
    await this.request("send", { message });
  }

  async feed(): Promise<ChatFeed> {
    const response = await this.fetcher("/player-history-api/messages", {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Chat feed unavailable");
    if (!response.json) throw new Error("Chat feed returned an invalid response");
    return parseChatFeed(await response.json());
  }
}
