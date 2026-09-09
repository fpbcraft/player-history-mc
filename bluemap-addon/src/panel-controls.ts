export interface ReplayControls {
  all: HTMLButtonElement;
  back: HTMLButtonElement;
  "chat-close": HTMLButtonElement;
  "chat-connect": HTMLButtonElement;
  "chat-logout": HTMLButtonElement;
  "chat-message": HTMLInputElement;
  "chat-status": HTMLOutputElement;
  close: HTMLButtonElement;
  compact: HTMLButtonElement;
  current: HTMLOutputElement;
  "date-from": HTMLInputElement;
  "date-to": HTMLInputElement;
  days: HTMLInputElement;
  end: HTMLSpanElement;
  forward: HTMLButtonElement;
  heat: HTMLButtonElement;
  latest: HTMLButtonElement;
  open: HTMLButtonElement;
  play: HTMLButtonElement;
  "player-count": HTMLSpanElement;
  players: HTMLButtonElement;
  range: HTMLInputElement;
  "range-button": HTMLButtonElement;
  "range-label": HTMLSpanElement;
  speed: HTMLInputElement;
  "speed-button": HTMLButtonElement;
  start: HTMLSpanElement;
  timeline: HTMLInputElement;
  "trail-label": HTMLSpanElement;
  trails: HTMLInputElement;
  "trails-button": HTMLButtonElement;
  webchat: HTMLButtonElement;
}

export class PanelControls {
  constructor(private readonly root: ParentNode) {}

  get<Name extends keyof ReplayControls>(name: Name): ReplayControls[Name] {
    const element = this.root.querySelector(`[name="${name}"], [data-control="${name}"]`);
    if (!element) throw new Error(`Missing replay panel control: ${name}`);
    return element as ReplayControls[Name];
  }
}
