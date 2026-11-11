const selector = ".history-offline-location, .bm-marker-player";

/** Touch uses an explicit label state; desktop labels are controlled by hover CSS. */
export class MapPlayerLabels {
  private open: HTMLElement | undefined;
  private pressed: { element: HTMLElement; x: number; y: number } | undefined;

  constructor(signal: AbortSignal) {
    document.addEventListener(
      "pointerdown",
      (event) => {
        const marker =
          event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
        if (!marker || marker !== this.open) this.close();
        this.pressed =
          event.pointerType === "touch" && marker
            ? { element: marker, x: event.clientX, y: event.clientY }
            : undefined;
      },
      { signal },
    );
    document.addEventListener(
      "pointerup",
      (event) => {
        const pressed = this.pressed;
        this.pressed = undefined;
        if (
          !pressed ||
          event.pointerType !== "touch" ||
          Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 8
        )
          return;
        if (this.open === pressed.element) this.close();
        else {
          this.close();
          this.open = pressed.element;
          this.open.dataset.historyLabelOpen = "true";
        }
      },
      { signal },
    );
    document.addEventListener(
      "pointercancel",
      () => {
        this.pressed = undefined;
      },
      { signal },
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") this.close();
      },
      { signal },
    );
    window.addEventListener("blur", () => this.close(), { signal });
    signal.addEventListener("abort", () => this.close(), { once: true });
  }

  private close(): void {
    if (this.open) delete this.open.dataset.historyLabelOpen;
    this.open = undefined;
  }
}
