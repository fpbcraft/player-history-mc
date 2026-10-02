import { OFFLINE, ReplayEngine } from "./replay-core.js";
import type { HistoryPoint } from "./types.js";

/**
 * Smooths the live player feed without changing historical replay semantics.
 *
 * The live endpoint is published and polled at a much lower cadence than the browser
 * render loop. Keep one feed interval of latency, then advance a synthetic live clock
 * between snapshots so ReplayEngine can interpolate the same way it does historically.
 */
export class LiveReplaySession {
  private readonly engine = new ReplayEngine();
  private generatedAt: number | undefined;
  private receivedAt = 0;

  constructor(private readonly delayMs = 1_000) {}

  reset(): void {
    this.engine.setPoints([]);
    this.generatedAt = undefined;
    this.receivedAt = 0;
  }

  update(
    points: readonly HistoryPoint[],
    generatedAt: number,
    receivedAt = performance.now(),
  ): void {
    // Polling and file publication are both interval based, so the browser can
    // occasionally receive the same snapshot twice. Re-anchoring that duplicate would
    // rewind the interpolation clock by a full interval and recreate the visible stutter.
    if (this.generatedAt !== undefined && generatedAt <= this.generatedAt) return;

    this.engine.setPoints([...points]);
    this.generatedAt = generatedAt;
    this.receivedAt = receivedAt;
  }

  playbackTime(now = performance.now()): number | null {
    if (this.generatedAt === undefined) return null;

    const elapsed = Math.max(0, now - this.receivedAt);
    return Math.min(this.generatedAt, this.generatedAt - this.delayMs + elapsed);
  }

  positions(
    players: Iterable<number>,
    world: number | undefined,
    now = performance.now(),
  ): HistoryPoint[] {
    const time = this.playbackTime(now);
    if (time === null || world === undefined) return [];

    const positions: HistoryPoint[] = [];
    for (const player of players) {
      let point = this.engine.position(player, time);
      let firstSampleFallback = false;

      // A just-opened panel can briefly have only one current sample. Keep a newly seen
      // online player visible while the interpolation buffer fills rather than hiding
      // them for one poll interval.
      if (!point) {
        const first = this.engine.players.get(player)?.[0];
        if (
          first &&
          !(first.flags & OFFLINE) &&
          first.time > time &&
          first.time <= (this.generatedAt ?? first.time)
        ) {
          point = { ...first };
          firstSampleFallback = true;
        }
      }

      if (point?.world !== world) continue;
      positions.push(firstSampleFallback ? point : { ...point, time });
    }
    return positions;
  }
}
