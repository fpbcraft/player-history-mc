export const BREAK = 1,
  OFFLINE = 2,
  HOLD = 4,
  CONTEXT = 8;
export function connects(a, b) {
  return !(a.flags & OFFLINE) && a.world === b.world && !(b.flags & BREAK);
}
export function mergePoints(chunks) {
  const points = chunks.flatMap((c) => c.points || []);
  const originals = new Set(
    points
      .filter((p) => !(p.flags & CONTEXT))
      .map((p) => `${p.player}:${p.time}`),
  );
  const seen = new Set();
  return points
    .filter((p) => {
      if (p.flags & CONTEXT && originals.has(`${p.player}:${p.time}`))
        return false;
      const key = JSON.stringify(p);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.time - b.time);
}
export class ReplayEngine {
  constructor(points = []) {
    this.setPoints(points);
  }
  setPoints(points) {
    this.players = new Map();
    for (const p of points) {
      if (!this.players.has(p.player)) this.players.set(p.player, []);
      this.players.get(p.player).push(p);
    }
  }
  position(id, time) {
    const points = this.players.get(id) || [];
    let lo = 0,
      hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (points[mid].time <= time) lo = mid + 1;
      else hi = mid;
    }
    if (!lo) return null;
    const a = points[lo - 1],
      b = points[lo];
    if (a.flags & OFFLINE) return null;
    if (!b || !connects(a, b) || b.time === a.time) return { ...a };
    const r = (time - a.time) / (b.time - a.time);
    return {
      ...a,
      x: a.x + (b.x - a.x) * r,
      y: a.y + (b.y - a.y) * r,
      z: a.z + (b.z - a.z) * r,
    };
  }
  trails(id, from, to) {
    const points = this.players.get(id) || [],
      segments = [];
    let line = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      if (b.time < from || a.time > to || !connects(a, b)) {
        if (line.length > 1) segments.push(line);
        line = [];
        continue;
      }
      const lo = Math.max(from, a.time),
        hi = Math.min(to, b.time);
      if (hi < lo) continue;
      const at = (t) => {
        const r = b.time === a.time ? 1 : (t - a.time) / (b.time - a.time);
        return {
          ...a,
          time: t,
          x: a.x + (b.x - a.x) * r,
          y: a.y + (b.y - a.y) * r,
          z: a.z + (b.z - a.z) * r,
        };
      };
      if (!line.length) line.push(at(lo));
      line.push(at(hi));
    }
    if (line.length > 1) segments.push(line);
    return segments;
  }
}
export class ChunkCache {
  constructor(base, duration, fetcher = (...args) => fetch(...args)) {
    this.base = base;
    this.duration = duration;
    this.fetcher = fetcher;
    this.cache = new Map();
    this.generation = 0;
  }
  async read(start, signal) {
    if (this.cache.has(start)) return this.cache.get(start);
    const res = await this.fetcher(`${this.base}/chunks/${start}.json`, {
      signal,
      cache: "no-store",
    });
    if (!res.ok && res.status !== 404)
      throw Error(`History HTTP ${res.status}`);
    const text =
      res.status === 404 ? '{"points":[],"events":[]}' : await res.text();
    if (text.length > 64 * 1024 * 1024)
      throw Error("Chunk exceeds browser size limit");
    const data = JSON.parse(text);
    if (!Array.isArray(data.points) || data.points.length > 1000000)
      throw Error("Invalid or oversized history chunk");
    if (signal?.aborted) throw new DOMException("Obsolete read", "AbortError");
    this.cache.set(start, data);
    while (this.cache.size > 3)
      this.cache.delete(this.cache.keys().next().value);
    return data;
  }
  async window(time) {
    this.controller?.abort();
    this.controller = new AbortController();
    const generation = ++this.generation;
    const start = Math.floor(time / this.duration) * this.duration;
    const chunks = await Promise.all(
      [start - this.duration, start, start + this.duration].map((t) =>
        this.read(t, this.controller.signal),
      ),
    );
    if (generation !== this.generation)
      throw new DOMException("Obsolete seek", "AbortError");
    return {
      points: chunks[1].points.length ? mergePoints(chunks) : [],
      events: chunks.flatMap((c) => c.events || []),
    };
  }
  clear() {
    this.generation++;
    this.controller?.abort();
    this.cache.clear();
  }
}
export function heatmapPlan(from, to, chunk) {
  // Aggregates are aligned outward to whole recording chunks; UI displays this precision.
  from = Math.floor(from / chunk) * chunk;
  to = Math.ceil(to / chunk) * chunk;
  const plan = [];
  for (let t = from; t < to;) {
    let span = chunk,
      level = "chunk";
    if (t % 86400000 === 0 && to - t >= 86400000) {
      span = 86400000;
      level = "day";
    } else if (t % 3600000 === 0 && to - t >= 3600000) {
      span = 3600000;
      level = "hour";
    }
    plan.push({ time: t, level });
    t += span;
    if (plan.length > 2000)
      throw Error(
        "Heatmap range exceeds 2000 aggregate files; narrow the range",
      );
  }
  return plan;
}
