export type ReplayStatusChannel =
  | "configuration"
  | "context"
  | "error"
  | "loading"
  | "range";

const PRIORITY: Record<ReplayStatusChannel, number> = {
  error: 5,
  range: 4,
  loading: 3,
  configuration: 2,
  context: 1,
};

export class StatusCoordinator {
  private readonly messages = new Map<ReplayStatusChannel, string>();

  constructor(private readonly element: HTMLElement) {}

  show(channel: ReplayStatusChannel, message: string): void {
    if (channel !== "error") this.messages.delete("error");
    this.messages.set(channel, message);
    this.render();
  }

  clear(channel: ReplayStatusChannel): void {
    this.messages.delete(channel);
    this.render();
  }

  private render(): void {
    let selected: ReplayStatusChannel | undefined;
    for (const channel of this.messages.keys()) {
      if (!selected || PRIORITY[channel] > PRIORITY[selected]) selected = channel;
    }
    this.element.textContent = selected ? (this.messages.get(selected) ?? "") : "";
  }
}
