export type ReplayRequest =
  | "activity"
  | "heatmap"
  | "live"
  | "manifest"
  | "range-events"
  | "trails";

export class RequestCoordinator {
  private readonly active = new Map<ReplayRequest, AbortController>();

  start(request: ReplayRequest): AbortController {
    this.abort(request);
    const controller = new AbortController();
    this.active.set(request, controller);
    return controller;
  }

  pending(request: ReplayRequest): boolean {
    return this.active.has(request);
  }

  current(request: ReplayRequest, controller: AbortController): boolean {
    return this.active.get(request) === controller && !controller.signal.aborted;
  }

  finish(request: ReplayRequest, controller: AbortController): void {
    if (this.active.get(request) === controller) this.active.delete(request);
  }

  abort(request: ReplayRequest): void {
    this.active.get(request)?.abort();
    this.active.delete(request);
  }

  abortAll(): void {
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
  }
}
