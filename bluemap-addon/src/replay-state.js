export const HISTORY_WINDOW = 3 * 3600000;
export const clamp = (value, from, to) => Math.max(from, Math.min(to, value));

// Minute counts are spread over intersecting display bins; partial minutes are estimates.
export function addActivityBins(bins, rows, from, to) {
  for (const [time, count] of rows) {
    if (!Number.isFinite(time) || !Number.isFinite(count) || count <= 0)
      continue;
    if (from === to) {
      if (time <= from && from < time + 60000) bins[0] += count;
      continue;
    }
    const lo = Math.max(from, time),
      hi = Math.min(to, time + 60000);
    if (hi <= lo) continue;
    const width = (to - from) / bins.length;
    const first = Math.max(0, Math.floor((lo - from) / width));
    const last = Math.min(bins.length - 1, Math.ceil((hi - from) / width) - 1);
    for (let i = first; i <= last; i++) {
      const overlap =
        Math.min(hi, from + (i + 1) * width) - Math.max(lo, from + i * width);
      bins[i] += (count * overlap) / 60000;
    }
  }
}

export function shuttleRate(position) {
  const stops = [
    [-1, -120],
    [-0.85, -60],
    [-0.7, -16],
    [-0.5, -4],
    [-0.35, -2],
    [-0.25, -1],
    [-0.16, 0],
    [-0.1, 0.5],
    [0, 1],
    [0.25, 2],
    [0.5, 4],
    [0.7, 16],
    [0.85, 60],
    [1, 120],
  ];
  const x = clamp(position, -1, 1);
  for (let i = 1; i < stops.length; i++) {
    const [a, rate] = stops[i - 1],
      [b, next] = stops[i];
    if (x <= b) return rate + ((next - rate) * (x - a)) / (b - a);
  }
  return 120;
}

export class ReplayClock {
  playbackRate = 1;
  rangeDuration = HISTORY_WINDOW;
  customRange = null;
  isPlaying = false;
  isShuttling = false;
  shuttleRate = 1;
  get atLatest() {
    return this.to - this.time <= 1000;
  }
  get rate() {
    return this.isShuttling
      ? this.shuttleRate
      : this.isPlaying
        ? this.playbackRate
        : 0;
  }
  refresh(earliest, latest, reset = false) {
    const follow = reset || this.time === undefined || this.atLatest;
    this.from = this.customRange
      ? this.customRange.from
      : Number.isFinite(this.rangeDuration) ? latest - this.rangeDuration : earliest;
    this.to = this.customRange
      ? this.customRange.to
      : latest;
    this.seek(follow ? this.to : this.time);
  }
  seek(time) {
    this.time = clamp(time, this.from, this.to);
  }
  togglePlayback() {
    if (!this.isPlaying && this.time >= this.to) this.seek(this.from);
    this.isPlaying = !this.isPlaying;
  }
  tick(delta) {
    this.seek(this.time + delta * this.rate);
    if (!this.isShuttling && this.time >= this.to) this.isPlaying = false;
  }
  shuttle(position) {
    this.isShuttling = true;
    this.shuttleRate = shuttleRate(position);
  }
  release() {
    this.isShuttling = false;
    this.shuttleRate = 1;
  }
}

export function visibleEvents(
  events,
  { from, time, trailMode, disabled = new Set() },
) {
  const start =
    trailMode === Infinity ? from : Math.max(from, time - (trailMode || 30000));
  return events.filter(
    (event) =>
      !disabled.has(event.type) &&
      event.point.time >= start &&
      event.point.time <= time,
  );
}
