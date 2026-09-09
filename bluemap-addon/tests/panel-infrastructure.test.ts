// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelLifecycle } from "../src/panel-lifecycle.js";
import { RequestCoordinator } from "../src/request-coordinator.js";
import { StatusCoordinator } from "../src/status-coordinator.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("panel lifecycle", () => {
  it("disposes listeners, timers, and animation frames together", () => {
    vi.useFakeTimers();
    const lifecycle = new PanelLifecycle();
    const target = new EventTarget();
    const listener = vi.fn();
    const interval = vi.fn();
    const timeout = vi.fn();
    const frame = vi.fn();

    target.addEventListener("change", listener, { signal: lifecycle.signal });
    lifecycle.interval(interval, 10);
    lifecycle.timeout(timeout, 10);
    lifecycle.frame(frame);
    lifecycle.dispose();

    target.dispatchEvent(new Event("change"));
    vi.runAllTimers();
    expect(listener).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    expect(frame).not.toHaveBeenCalled();
  });
});

describe("request coordinator", () => {
  it("aborts superseded requests and ignores stale completion", () => {
    const requests = new RequestCoordinator();
    const first = requests.start("trails");
    const second = requests.start("trails");

    expect(first.signal.aborted).toBe(true);
    expect(requests.current("trails", first)).toBe(false);
    expect(requests.current("trails", second)).toBe(true);
    requests.finish("trails", first);
    expect(requests.pending("trails")).toBe(true);
    requests.finish("trails", second);
    expect(requests.pending("trails")).toBe(false);
  });

  it("aborts every active request on disconnect", () => {
    const requests = new RequestCoordinator();
    const activity = requests.start("activity");
    const live = requests.start("live");

    requests.abortAll();

    expect(activity.signal.aborted).toBe(true);
    expect(live.signal.aborted).toBe(true);
  });
});

describe("status coordinator", () => {
  it("keeps a loading message from hiding a more important error", () => {
    const element = document.createElement("output");
    const status = new StatusCoordinator(element);

    status.show("loading", "Loading trails…");
    status.show("error", "The recording is unavailable");
    expect(element.textContent).toBe("The recording is unavailable");
    status.clear("error");
    expect(element.textContent).toBe("Loading trails…");
  });
});
