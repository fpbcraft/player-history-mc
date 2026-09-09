export type PanelTimer = ReturnType<typeof setTimeout>;

export class PanelLifecycle {
  private readonly abortController = new AbortController();
  private readonly intervals = new Set<PanelTimer>();
  private readonly timeouts = new Set<PanelTimer>();
  private readonly frames = new Set<number>();

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  interval(callback: () => void, delay: number): PanelTimer {
    const timer = setInterval(callback, delay);
    this.intervals.add(timer);
    return timer;
  }

  clearInterval(timer: PanelTimer | undefined): void {
    if (timer === undefined) return;
    clearInterval(timer);
    this.intervals.delete(timer);
  }

  timeout(callback: () => void, delay: number): PanelTimer {
    const timer = setTimeout(() => {
      this.timeouts.delete(timer);
      callback();
    }, delay);
    this.timeouts.add(timer);
    return timer;
  }

  clearTimeout(timer: PanelTimer | undefined): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timeouts.delete(timer);
  }

  frame(callback: FrameRequestCallback): number {
    const frame = requestAnimationFrame((time) => {
      this.frames.delete(frame);
      callback(time);
    });
    this.frames.add(frame);
    return frame;
  }

  cancelFrame(frame: number | undefined): void {
    if (frame === undefined) return;
    cancelAnimationFrame(frame);
    this.frames.delete(frame);
  }

  dispose(): void {
    this.abortController.abort();
    for (const timer of this.intervals) clearInterval(timer);
    for (const timer of this.timeouts) clearTimeout(timer);
    for (const frame of this.frames) cancelAnimationFrame(frame);
    this.intervals.clear();
    this.timeouts.clear();
    this.frames.clear();
  }
}
