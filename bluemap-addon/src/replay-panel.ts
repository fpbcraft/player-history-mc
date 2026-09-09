import { BlueMapAdapter } from "./bluemap-adapter.js";
import type { BlueMapApp, BlueMapRuntime } from "./bluemap-types.js";
import { ChatClient, HistoryClient } from "./http-client.js";
import { PanelControls, type ReplayControls } from "./panel-controls.js";
import { PanelLifecycle, type PanelTimer } from "./panel-lifecycle.js";
import {
  DEFAULT_DISABLED_EVENTS,
  KNOWN_EVENT_TYPES,
  SPEED_OPTIONS,
  TRAIL_OPTIONS,
} from "./panel-options.js";
import { preferences } from "./preferences.js";
import {
  BREAK,
  ChunkCache,
  CONTEXT,
  heatmapPlan,
  mergePoints,
  ReplayEngine,
} from "./replay-core.js";
import { createReplayPanelState, type ReplayPanelState } from "./replay-panel-state.js";
import {
  addActivityBins,
  clamp,
  combineProductionEvents,
  ReplayClock,
  visibleEvents,
} from "./replay-state.js";
import { RequestCoordinator } from "./request-coordinator.js";
import { describeState, TelemetryCache } from "./telemetry.js";
import type { HistoryEvent, HistoryManifest, HistoryPoint, IntegrationMapping } from "./types.js";
import { renderActivityHistogram } from "./ui/activity-histogram-view.js";
import { renderEventFilter } from "./ui/event-filter-view.js";
import { renderHistoryEvents } from "./ui/history-events-view.js";
import { renderPlayerFilter } from "./ui/player-filter-view.js";
import { mountReplayPanelView, unmountReplayPanelView } from "./ui/replay-panel-view.js";
import { renderWebChatFeed } from "./ui/webchat-feed-view.js";

declare global {
  interface Window {
    bluemap: BlueMapApp & { switchMap?(id: string, animate: boolean): Promise<void> };
    BlueMap: BlueMapRuntime;
  }
}

const BASE_URL = new URL("player-history/", globalThis.location?.href ?? "http://localhost/");
const formatDate = (time: number, seconds = true): string =>
  new Date(time).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(seconds ? { second: "2-digit" } : {}),
  });

type HeatmapRow = [number, number, number, number, number];

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class ReplayPanel extends HTMLElement {
  private readonly historyClient = new HistoryClient(BASE_URL);
  private clock = new ReplayClock();
  private engine = new ReplayEngine();
  private names = new Map<number, string>();
  private selection = new Set<number>();
  private disabledEvents = new Set<string>();
  private eventTypes = new Set<string>();
  private events: HistoryEvent[] = [];
  private rangeEvents: HistoryEvent[] = [];
  private liveEvents: HistoryEvent[] = [];
  private livePoints: HistoryPoint[] = [];
  private manifest?: HistoryManifest;
  private integration?: IntegrationMapping;
  private cache: ChunkCache | undefined;
  private telemetryCache: TelemetryCache | undefined;
  private adapter: BlueMapAdapter | undefined;
  private fullTrails: ReplayEngine | null = null;
  private heatRows: HeatmapRow[] | null = null;
  private status!: HTMLElement;
  private mobileQuery!: MediaQueryList;
  private controls = new PanelControls(this);
  private lifecycle = new PanelLifecycle();
  private requests = new RequestCoordinator();
  private panelState: ReplayPanelState = createReplayPanelState();
  private chatClient!: ChatClient;
  private chatToken = "";
  private requestId = 0;
  private lastFrame = 0;
  private lastOverlay: number | undefined;
  private lastMap: string | undefined;
  private loadedBucket: number | undefined;
  private pendingBucket: number | undefined;
  private shuttlePointer: number | undefined;
  private heatVersion = 0;
  private chatTimer: PanelTimer | undefined;
  private seekTimer: PanelTimer | undefined;
  private eventKey: string | null = null;
  private trailKey: string | null = null;
  private trailDataKey: string | null = null;
  private heatKey: string | null = null;
  private healthKey: string | null = null;
  private timelineEventKey: string | null = null;
  private eventRevision = 0;
  private registryRevision = 0;
  private selectionRevision = 0;
  private filterRevision = 0;
  private healthToken: object = {};
  private trailMode = 60_000;
  private releaseShuttle: () => void = () => {};

  private get compact(): boolean {
    return this.panelState.compact;
  }

  private set compact(value: boolean) {
    this.panelState.compact = value;
  }

  private get opened(): boolean {
    return this.panelState.panel === "open";
  }

  private set opened(value: boolean) {
    this.panelState.panel = value ? "open" : "closed";
  }

  private get isLive(): boolean {
    return this.panelState.mode === "live";
  }

  private set isLive(value: boolean) {
    this.panelState.mode = value ? "live" : "historical";
  }

  private get heatEnabled(): boolean {
    return this.panelState.heatmap;
  }

  private set heatEnabled(value: boolean) {
    this.panelState.heatmap = value;
  }

  private get chatPinned(): boolean {
    return this.panelState.chatPinned;
  }

  private set chatPinned(value: boolean) {
    this.panelState.chatPinned = value;
  }

  private get chatLoading(): boolean {
    return this.panelState.chatLoading;
  }

  private set chatLoading(value: boolean) {
    this.panelState.chatLoading = value;
  }

  private get liveLoading(): boolean {
    return this.panelState.liveLoading;
  }

  private set liveLoading(value: boolean) {
    this.panelState.liveLoading = value;
  }

  private get refreshing(): boolean {
    return this.panelState.refreshing;
  }

  private set refreshing(value: boolean) {
    this.panelState.refreshing = value;
  }

  private get hasSavedSelection(): boolean {
    return this.panelState.hasSavedSelection;
  }

  private set hasSavedSelection(value: boolean) {
    this.panelState.hasSavedSelection = value;
  }

  private get scrubbing(): boolean {
    return this.panelState.scrubbing;
  }

  private set scrubbing(value: boolean) {
    this.panelState.scrubbing = value;
  }

  q<Name extends keyof ReplayControls>(name: Name): ReplayControls[Name] {
    this.controls ??= new PanelControls(this);
    return this.controls.get(name);
  }

  private require<T extends Element = HTMLElement>(selector: string): T {
    const element = this.querySelector<T>(selector);
    if (!element) throw new Error(`Missing replay panel element: ${selector}`);
    return element;
  }

  connectedCallback(): void {
    this.lifecycle.dispose();
    this.requests.abortAll();
    this.lifecycle = new PanelLifecycle();
    this.requests = new RequestCoordinator();
    this.panelState = createReplayPanelState();
    this.eventRevision = 0;
    this.registryRevision = 0;
    this.selectionRevision = 0;
    this.filterRevision = 0;
    mountReplayPanelView(this);
    this.controls = new PanelControls(this);
    const eventControl = this.require<HTMLDetailsElement>(".history-event-control");
    const eventMenu = this.require<HTMLElement>(".history-event-options");
    eventMenu.setAttribute("popover", "manual");
    eventControl.ontoggle = () =>
      this.showMenu(
        eventMenu,
        this.require<HTMLElement>(".history-event-control summary"),
        eventControl.open,
      );
    this.require<HTMLElement>("#history-players").setAttribute("popover", "manual");
    this.clock = new ReplayClock();
    const savedRange = preferences.range();
    if (
      savedRange &&
      savedRange !== "dates" &&
      [...this.q("range").options].some((option) => option.value === savedRange)
    )
      this.q("range").value = savedRange;
    const savedDays = preferences.days();
    if (savedDays !== null && Number.isInteger(savedDays) && savedDays > 0 && savedDays <= 36500)
      this.q("days").value = String(savedDays);
    const initialRange = this.q("range").value;
    this.clock.rangeDuration =
      initialRange === "all"
        ? Infinity
        : Number(initialRange === "custom" ? this.q("days").value : initialRange) * 86400000;
    const savedSpeed = preferences.speed();
    if (savedSpeed !== null && SPEED_OPTIONS.includes(savedSpeed as (typeof SPEED_OPTIONS)[number]))
      this.clock.playbackRate = savedSpeed;
    this.isLive = true;
    this.liveEvents = [];
    this.livePoints = [];
    this.mobileQuery = matchMedia("(max-width: 600px)");
    this.compact = this.mobileQuery.matches;
    this.classList.toggle("compact", this.compact);
    this.q("compact").onclick = () => {
      this.closeChoices();
      this.compact = !this.compact;
      this.classList.toggle("compact", this.compact);
      this.q("compact").setAttribute("aria-expanded", String(!this.compact));
      this.q("compact").setAttribute(
        "aria-label",
        this.compact ? "Expand controls" : "Collapse controls",
      );
      this.q("compact").textContent = this.compact ? "⌃" : "⌄";
      this.sync();
    };
    this.mobileQuery.addEventListener?.(
      "change",
      (event) => {
        this.compact = event.matches;
        this.classList.toggle("compact", this.compact);
        this.q("compact").setAttribute("aria-expanded", String(!this.compact));
        this.q("compact").setAttribute(
          "aria-label",
          this.compact ? "Expand controls" : "Collapse controls",
        );
        this.q("compact").textContent = this.compact ? "⌃" : "⌄";
        this.sync();
      },
      { signal: this.lifecycle.signal },
    );
    this.engine = new ReplayEngine();
    this.names = new Map();
    this.selection = new Set();
    try {
      const selected = preferences.players();
      if (Array.isArray(selected)) {
        this.selection = new Set(selected.filter(Number.isFinite));
        this.hasSavedSelection = true;
      }
    } catch {}
    this.events = [];
    this.disabledEvents = new Set(DEFAULT_DISABLED_EVENTS);
    try {
      const saved = preferences.hiddenEvents();
      if (Array.isArray(saved))
        this.disabledEvents = new Set(saved.filter((type) => typeof type === "string"));
    } catch {}
    this.eventTypes = new Set(KNOWN_EVENT_TYPES);
    this.renderEventFilters();
    const savedTrail = String(preferences.trails());
    this.trailMode = savedTrail === "Infinity" ? Infinity : Number(savedTrail ?? 60000);
    if (!TRAIL_OPTIONS.some(([value]) => Object.is(value, this.trailMode))) this.trailMode = 60000;
    this.heatEnabled = preferences.heatmap();
    this.chatPinned = true;
    this.rangeEvents = [];
    this.requestId = 0;
    this.status = this.require<HTMLElement>(".history-status");
    this.chatClient = new ChatClient(() => this.chatToken);
    this.chatToken = preferences.chatToken();
    this.q("webchat").onclick = async () => {
      const box = this.require<HTMLElement>(".history-chat-panel");
      box.hidden = false;
      this.q("webchat").hidden = true;
      this.q("webchat").setAttribute("aria-expanded", "true");
      if (this.mobileQuery.matches) {
        if (this.opened) this.close();
        this.q("open").hidden = true;
      }
      await this.refresh(true);
      await this.loadRangeEvents();
      this.updateOverlays();
      this.lifecycle.clearInterval(this.chatTimer);
      this.pollChat();
      this.chatTimer = this.lifecycle.interval(() => this.pollChat(), 2000);
    };
    this.q("chat-close").onclick = () => this.closeChat();
    this.q("chat-connect").onclick = async () => {
      try {
        const pair = await this.chatClient.pair();
        this.chatToken = pair.token;
        preferences.saveChatToken(pair.token);
        this.q("chat-status").textContent =
          `Run /webchat link ${pair.code} in Minecraft (expires in 5 minutes).`;
      } catch (error) {
        this.q("chat-status").textContent = errorMessage(error);
      }
    };
    this.q("chat-logout").onclick = async () => {
      try {
        await this.chatClient.logout();
        this.chatToken = "";
        preferences.saveChatToken("");
        this.q("chat-status").textContent = "Logged out";
        this.pollChat();
      } catch (error) {
        this.q("chat-status").textContent = errorMessage(error);
      }
    };
    this.require<HTMLFormElement>(".history-chat-form").onsubmit = async (event: SubmitEvent) => {
      event.preventDefault();
      const input = this.q("chat-message");
      const button = this.require<HTMLButtonElement>(".history-chat-form button");
      button.disabled = true;
      try {
        await this.chatClient.send(input.value);
        input.value = "";
        await this.pollChat();
      } catch (error) {
        this.q("chat-status").textContent = errorMessage(error);
      } finally {
        button.disabled = false;
      }
    };
    this.q("open").onclick = () => this.open();
    this.q("close").onclick = () => this.close();
    this.q("speed").onchange = () => {
      this.clock.playbackRate = Number(this.q("speed").value);
      preferences.saveSpeed(this.clock.playbackRate);
      this.q("speed-button").title = `Playback speed: ${this.clock.playbackRate}×`;
      this.require<HTMLElement>(".history-speed-popover").hidden = true;
      this.sync();
    };
    for (const [kind, selector] of [
      ["speed", "data-speed"],
      ["trails", "data-trail"],
    ] as const) {
      const menu = this.require<HTMLElement>(`.history-${kind}-popover`);
      const trigger = this.q(`${kind}-button`);
      menu.setAttribute("popover", "manual");
      trigger.onclick = () => {
        const open = menu.hidden;
        this.closeChoices();
        if (open) {
          menu.hidden = false;
          menu.showPopover?.();
          const bounds = trigger.getBoundingClientRect();
          menu.style.left = `${Math.max(8, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
          menu.style.top = `${Math.max(8, bounds.top - menu.offsetHeight - 8)}px`;
        }
        trigger.setAttribute("aria-expanded", String(open));
      };
      menu.querySelectorAll<HTMLButtonElement>(`[${selector}]`).forEach((button) => {
        button.onclick = () => {
          this.q(kind).value = button.getAttribute(selector) ?? "";
          this.q(kind).onchange?.(new Event("change"));
          menu.querySelectorAll<HTMLButtonElement>("button").forEach((option) => {
            option.setAttribute("aria-pressed", String(option === button));
          });
          this.closeChoices();
        };
      });
    }
    this.q("range").onchange = () => {
      const custom = this.q("range").value === "custom";
      const dates = this.q("range").value === "dates";
      this.require<HTMLElement>(".history-custom-dates").hidden = !dates;
      if (dates) {
        const local = (t: number) =>
          new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 19);
        if (this.manifest) {
          this.q("date-from").value = local(this.clock.from);
          this.q("date-to").value = local(this.clock.to);
        }
        this.q("date-from").focus();
      }
      this.require<HTMLElement>(".history-custom-days").hidden = !custom;
      if (custom) this.q("days").focus();
      else if (!dates) this.changeRange();
    };
    this.require<HTMLFormElement>(".history-custom-days").onsubmit = (event) => {
      event.preventDefault();
      this.changeRange();
    };
    this.require<HTMLFormElement>(".history-custom-dates").onsubmit = (event) => {
      event.preventDefault();
      this.changeRange();
    };
    this.q("back").onclick = () => this.seek(this.clock.time - 300000);
    this.q("forward").onclick = () => this.seek(this.clock.time + 300000);
    this.q("latest").onclick = () => {
      this.goNow();
    };
    this.q("play").onclick = () => {
      this.isLive = false;
      this.clock.togglePlayback();
      this.seek(this.clock.time);
      this.sync();
    };
    const timeline = this.q("timeline");
    timeline.oninput = () => {
      const value = Number(timeline.value);
      if (value >= Number(timeline.max) - 1) this.goNow();
      else this.seek(this.clock.from + value);
    };
    timeline.onpointerdown = () => {
      this.scrubbing = true;
      this.sync();
    };
    const finishScrub = () => {
      this.scrubbing = false;
      this.sync();
    };
    this.addEventListener("pointerup", finishScrub, { signal: this.lifecycle.signal });
    this.addEventListener("pointercancel", finishScrub, { signal: this.lifecycle.signal });
    timeline.onblur = finishScrub;
    timeline.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 300000 : 10000;
      this.seek(
        event.key === "Home"
          ? this.clock.from
          : event.key === "End"
            ? this.clock.to
            : this.clock.time + (event.key === "ArrowLeft" ? -step : step),
      );
    };
    timeline.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.seek(this.clock.time + Math.sign(event.deltaY) * (event.shiftKey ? 300000 : 10000));
      },
      { passive: false },
    );
    const shuttle = this.q("shuttle");
    const move = (event: PointerEvent) => {
      const bounds = this.require<HTMLElement>(".history-shuttle-track").getBoundingClientRect();
      const position = clamp(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -1, 1);
      this.clock.shuttle(position);
      shuttle.style.setProperty("--shuttle", `${(position + 1) * 50}%`);
      this.sync();
    };
    shuttle.onpointerdown = (event) => {
      if (!Number.isFinite(this.clock.time)) return;
      if (event.button !== 0 || this.shuttlePointer !== undefined) return;
      event.preventDefault();
      shuttle.focus();
      shuttle.setPointerCapture(event.pointerId);
      this.shuttlePointer = event.pointerId;
      shuttle.classList.add("held");
      move(event);
    };
    shuttle.onpointermove = (event) => {
      if (event.pointerId === this.shuttlePointer) move(event);
    };
    const release = () => {
      this.shuttlePointer = undefined;
      this.clock.release();
      shuttle.classList.remove("held");
      shuttle.style.setProperty("--shuttle", "50%");
      this.sync();
    };
    shuttle.onpointerup = shuttle.onpointercancel = shuttle.onlostpointercapture = release;
    shuttle.onblur = release;
    shuttle.onkeydown = (event) => {
      if (!Number.isFinite(this.clock.time)) return;
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      this.clock.shuttle(event.key === "ArrowLeft" ? -0.5 : 0.5);
      shuttle.style.setProperty("--shuttle", event.key === "ArrowLeft" ? "25%" : "75%");
      this.sync();
    };
    shuttle.onkeyup = release;
    this.releaseShuttle = release;
    this.q("players").onclick = () => this.togglePlayers();
    this.q("all").onclick = () => {
      this.selection = new Set(this.names.keys());
      this.selectionRevision++;
      preferences.savePlayers(this.selection);
      this.hasSavedSelection = true;
      this.renderPlayers();
      this.updateOverlays();
    };
    this.q("trails").onchange = () => {
      this.trailMode = Number(this.q("trails").value);
      preferences.saveTrails(this.trailMode);
      this.trailDataKey = null;
      this.requests.abort("trails");
      this.fullTrails = null;
      this.sync();
      this.updateOverlays();
    };
    this.q("heat").onclick = () => {
      this.heatEnabled = !this.heatEnabled;
      preferences.saveHeatmap(this.heatEnabled);
      this.requests.abort("heatmap");
      this.sync();
      this.updateOverlays();
      if (this.heatEnabled) this.loadHeat();
    };
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (
          !(event.target instanceof Node) ||
          !eventControl.contains(event.target instanceof Node ? event.target : null)
        )
          eventControl.open = false;
        if (
          !this.require<HTMLElement>(".history-player-control").contains(
            event.target instanceof Node ? event.target : null,
          )
        )
          this.togglePlayers(false);
        for (const kind of ["speed", "trails"] as const) {
          if (
            !this.require<HTMLElement>(`.history-${kind}`).contains(
              event.target instanceof Node ? event.target : null,
            )
          ) {
            const menu = this.require<HTMLElement>(`.history-${kind}-popover`);
            menu.hidePopover?.();
            menu.hidden = true;
            this.q(`${kind}-button`).setAttribute("aria-expanded", "false");
          }
        }
      },
      { signal: this.lifecycle.signal },
    );
    this.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          this.closeChoices();
          this.togglePlayers(false);
          this.releaseShuttle();
          this.q("players").focus();
        }
      },
      { signal: this.lifecycle.signal },
    );
    window.addEventListener(
      "blur",
      () => {
        finishScrub();
        release();
      },
      { signal: this.lifecycle.signal },
    );
    this.lastFrame = performance.now();
    this.q("speed").value = String(this.clock.playbackRate);
    this.q("trails").value = String(this.trailMode);
    this.require<HTMLElement>(".history-chat").addEventListener(
      "scroll",
      (event) => {
        const chat = event.currentTarget as HTMLElement;
        this.chatPinned = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 20;
      },
      { signal: this.lifecycle.signal, passive: true },
    );
    this.sync();
    this.lifecycle.frame((time) => this.tickFrame(time));
    this.refresh(true).then(() => this.pollLive());
    this.lifecycle.interval(() => this.pollLive(), 1000);
    this.lifecycle.interval(() => this.refresh(), 45000);
  }
  closeChoices() {
    this.require<HTMLDetailsElement>(".history-event-control").open = false;
    for (const kind of ["speed", "trails"] as const) {
      const menu = this.require<HTMLElement>(`.history-${kind}-popover`);
      menu.hidePopover?.();
      menu.hidden = true;
      this.q(`${kind}-button`).setAttribute("aria-expanded", "false");
    }
  }
  private async pollChat(): Promise<void> {
    if (this.chatLoading) return;
    this.chatLoading = true;
    try {
      const session = await this.chatClient.session();
      this.q("chat-connect").hidden = session.linked;
      this.q("chat-logout").hidden = !session.linked;
      this.require<HTMLFormElement>(".history-chat-form").hidden = !session.linked;
      if (session.linked) this.q("chat-status").textContent = `Connected as ${session.name}`;
      const data = await this.chatClient.feed();
      const feed = this.require<HTMLElement>(".history-webchat-feed");
      const shouldFollow = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 20;
      renderWebChatFeed(feed, data.messages);
      if (shouldFollow) feed.scrollTop = feed.scrollHeight;
    } catch (error) {
      this.q("chat-status").textContent = errorMessage(error);
    } finally {
      this.chatLoading = false;
    }
  }
  async open() {
    if (this.mobileQuery.matches) this.closeChat();
    this.opened = true;
    if (this.mobileQuery.matches) this.q("webchat").hidden = true;
    this.q("open").hidden = true;
    this.q("open").setAttribute("aria-expanded", "true");
    this.require<HTMLElement>("section").hidden = false;
    this.q("close").focus();
    this.trailMode = this.trailMode || 60000;
    this.q("trails").value = String(this.trailMode);
    preferences.saveTrails(this.trailMode);
    this.goNow();
    await this.refresh(true);
  }
  close() {
    this.closeChoices();
    this.opened = false;
    this.lifecycle.clearInterval(this.chatTimer);
    this.clock.isPlaying = false;
    this.releaseShuttle();
    this.togglePlayers(false);
    this.requests.abort("heatmap");
    this.requests.abort("activity");
    this.require<HTMLElement>("section").hidden = true;
    this.q("open").hidden = false;
    if (this.mobileQuery.matches && this.require<HTMLElement>(".history-chat-panel").hidden)
      this.q("webchat").hidden = false;
    this.q("open").setAttribute("aria-expanded", "false");
    this.q("open").focus();
  }
  closeChat() {
    this.lifecycle.clearInterval(this.chatTimer);
    this.require<HTMLElement>(".history-chat-panel").hidden = true;
    this.q("webchat").hidden = false;
    this.q("webchat").setAttribute("aria-expanded", "false");
    if (this.mobileQuery.matches && !this.opened) this.q("open").hidden = false;
  }
  goNow() {
    this.isLive = true;
    this.clock.isPlaying = false;
    if (this.clock.customRange) {
      this.clock.customRange = null;
      this.q("range").value = preferences.range() || "0.125";
      this.require<HTMLElement>(".history-custom-dates").hidden = true;
    }
    if (this.manifest) {
      this.clock.refresh(
        this.manifest.earliestTimestamp,
        Math.max(this.manifest.latestTimestamp, Date.now()),
        true,
      );
      this.clock.seek(this.clock.to);
    }
    this.sync();
    this.render();
    this.updateOverlays();
    this.pollLive();
  }
  togglePlayers(
    open: boolean = this.require<HTMLElement>("#history-players").hidden === true,
  ): void {
    this.showMenu(this.require<HTMLElement>("#history-players"), this.q("players"), open);
    this.q("players").setAttribute("aria-expanded", String(open));
  }
  showMenu(menu: HTMLElement, trigger: HTMLElement, open: boolean): void {
    if (!open) {
      menu.hidePopover?.();
      menu.hidden = true;
      return;
    }
    menu.hidden = false;
    menu.showPopover?.();
    const bounds = trigger.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(bounds.top - menu.offsetHeight - 8, innerHeight - menu.offsetHeight - 8))}px`;
  }
  renderPlayers() {
    const list = this.require<HTMLElement>(".history-player-list");
    renderPlayerFilter(list, {
      names: this.names,
      selected: this.selection,
      onChange: (id, selected) => {
        if (selected) this.selection.add(id);
        else this.selection.delete(id);
        this.selectionRevision++;
        preferences.savePlayers(this.selection);
        this.hasSavedSelection = true;
        this.sync();
        this.updateOverlays();
      },
    });
    this.sync();
  }
  async refresh(reset = false) {
    if (this.refreshing) return;
    this.refreshing = true;
    const controller = this.requests.start("manifest");
    try {
      const m = await this.historyClient.manifest(controller.signal);
      const previous = this.manifest;
      const changed =
        reset ||
        !previous ||
        previous.latestTimestamp !== m.latestTimestamp ||
        previous.earliestTimestamp !== m.earliestTimestamp;
      this.manifest = m;
      this.telemetryCache?.chunks.clear();
      for (const [control, cap] of [
        ["trails", "movement"],
        ["heat", "heatmap"],
      ] as const) {
        const element = this.q(control);
        if (element) {
          element.disabled = m.capabilities?.[cap] === false;
          element.title = element.disabled ? `This dataset has no recorded ${cap}` : "";
        }
      }
      if (!this.integration) {
        this.integration = await this.historyClient.integration(controller.signal);
      }
      if (!this.cache || this.cache.duration !== m.chunkDurationMs) {
        this.cache?.clear();
        this.cache = new ChunkCache(new URL("data", BASE_URL).href, m.chunkDurationMs);
      }
      for (const player of m.registry.players) {
        if (!this.hasSavedSelection && !this.names.has(player.id)) this.selection.add(player.id);
      }
      this.names = new Map(m.registry.players.map((player) => [player.id, player.name]));
      this.selection = new Set([...this.selection].filter((id) => this.names.has(id)));
      this.registryRevision++;
      this.selectionRevision++;
      this.clock.refresh(m.earliestTimestamp, Math.max(m.latestTimestamp, Date.now()), reset);
      this.renderPlayers();
      if (changed) await this.reloadRange();
      else this.loadActivity();
      this.render();
      this.updateOverlays();
    } catch (error) {
      this.report(error);
    } finally {
      this.requests.finish("manifest", controller);
      this.refreshing = false;
    }
  }
  report(error: unknown): void {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      this.status.textContent = errorMessage(error);
  }
  async changeRange() {
    const choice = this.q("range").value;
    if (choice === "custom" && !this.q("days").reportValidity()) return;
    if (choice === "dates") {
      this.isLive = false;
      const from = new Date(this.q("date-from").value).getTime(),
        to = new Date(this.q("date-to").value).getTime();
      if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
        this.status.textContent = "Choose an end date after the start date.";
        return;
      }
      this.clock.customRange = { from, to };
    } else this.clock.customRange = null;
    if (choice !== "dates")
      this.clock.rangeDuration =
        choice === "all"
          ? Infinity
          : Number(choice === "custom" ? this.q("days").value : choice) * 86400000;
    preferences.saveRange(choice);
    if (choice === "custom") preferences.saveDays(Number(this.q("days").value));
    if (!this.manifest) return;
    this.clock.refresh(
      this.manifest.earliestTimestamp,
      Math.max(this.manifest.latestTimestamp, Date.now()),
    );
    this.sync();
    await this.reloadRange();
  }
  async loadActivity() {
    const controller = this.requests.start("activity");
    const { from, to } = this.clock,
      chart = this.require<HTMLElement>(".history-histogram");
    const caption = this.require<HTMLElement>(".history-density-status");
    chart.replaceChildren();
    if (!this.manifest?.activityBucketMs) {
      caption.textContent = "Recording density is not available yet";
      return;
    }
    const count = Math.max(12, Math.min(96, Math.floor((chart.clientWidth || 720) / 10)));
    const bins = Array(count).fill(0),
      day = 86400000;
    const first = Math.floor(from / day) * day,
      last = Math.floor(to / day) * day;
    if ((last - first) / day > 2000) {
      caption.textContent = "Choose a range of up to 2,000 days to show recording density";
      return;
    }
    caption.textContent = "Loading recording density…";
    try {
      for (let start = first; start <= last; start += day) {
        const rows = await this.historyClient.activity(start, controller.signal);
        addActivityBins(bins, rows, from, to);
      }
      if (controller.signal.aborted || !this.opened) return;
      const max = Math.max(0, ...bins);
      renderActivityHistogram(chart, { bins, from, to, formatTime: formatDate });
      const total = Math.round(bins.reduce((a, b) => a + b, 0));
      caption.textContent =
        this.manifest.activityReady === false
          ? "Recording density · history is still being indexed"
          : max
            ? "Recording density · all players · minute-level counts"
            : "No recorded samples in this range";
      chart.setAttribute(
        "aria-label",
        "Recording density: approximately " +
          total.toLocaleString() +
          " samples across " +
          count +
          " intervals. Taller bars mean more recorded samples.",
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        caption.textContent = errorMessage(error);
    } finally {
      this.requests.finish("activity", controller);
    }
  }
  async reloadRange() {
    this.loadActivity();
    if (!this.cache) return;
    this.cache.clear();
    this.requestId++;
    this.pendingBucket = this.loadedBucket = undefined;
    this.fullTrails = null;
    this.trailDataKey = null;
    this.requests.abort("trails");
    this.requests.abort("heatmap");
    this.heatRows = null;
    this.heatKey = this.trailKey = null;
    this.updateOverlays();
    this.loadRangeEvents();
    await this.loadWindow();
    if (this.heatEnabled && this.opened) this.loadHeat();
  }
  sync() {
    const c = this.clock,
      valid = Number.isFinite(c.time);
    for (const name of ["timeline", "back", "forward", "play", "latest", "trails", "heat"] as const)
      this.q(name).disabled = !valid;
    if (valid) {
      this.q("timeline").max = String(Math.max(1, c.to - c.from));
      this.q("timeline").value = String(c.time - c.from);
      this.q("timeline").disabled = c.from === c.to;
      this.q("timeline").setAttribute("aria-valuetext", formatDate(c.time));
      this.q("start").textContent = formatDate(c.from, false);
      this.q("end").textContent = formatDate(c.to, false);
      this.q("current").textContent = formatDate(c.time);
      this.q("latest").disabled = this.isLive;
      this.q("latest").setAttribute("aria-pressed", String(this.isLive));
      const tooltip = this.require<HTMLElement>(".history-tooltip");
      tooltip.hidden = !this.scrubbing;
      tooltip.textContent = formatDate(c.time);
      tooltip.style.left = `${clamp(((c.time - c.from) / Math.max(1, c.to - c.from)) * 100, 14, 86)}%`;
    }
    // Keep the visual control identical at every breakpoint; the accessible
    // label carries the full action name.
    this.q("play").textContent = c.isPlaying ? "Ⅱ" : "▶";
    this.q("play").setAttribute("aria-label", c.isPlaying ? "Pause replay" : "Play replay");
    this.q("rate").textContent = c.isShuttling
      ? `Shuttle · ${Number(c.shuttleRate.toFixed(1))}×`
      : `Shuttle · release to ${c.playbackRate}×`;
    this.q("shuttle").setAttribute("aria-valuenow", c.shuttleRate.toFixed(1));
    this.q("players").title = `Players · ${this.selection.size} selected`;
    this.q("trails").value = String(this.trailMode);
    this.q("heat").setAttribute("aria-pressed", String(!!this.heatEnabled));
    this.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((button) => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === c.playbackRate));
    });
    this.querySelectorAll<HTMLButtonElement>("[data-trail]").forEach((button) => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.trail) === this.trailMode));
    });
  }
  async goToEvent(event: HistoryEvent): Promise<void> {
    if (!event?.point) return;
    this.seek(event.point.time);
    const worldKey = this.manifest?.registry?.worlds?.find(
      (world) => world.id === event.point.world,
    )?.key;
    const mapId = Object.entries(this.integration?.mapWorlds || {}).find(
      ([, key]) => key === worldKey,
    )?.[0];
    if (mapId && mapId !== this.adapter?.mapId && window.bluemap?.switchMap)
      await window.bluemap.switchMap(mapId, false);
    this.adapter?.focusPoint(event.point);
  }
  seek(time: number): void {
    this.isLive = false;
    if (!this.manifest || !Number.isFinite(time)) return;
    this.clock.seek(time);
    this.sync();
    this.render();
    if (!this.cache) return;
    const bucket = Math.floor(this.clock.time / this.cache.duration);
    if (bucket !== this.loadedBucket && bucket !== this.pendingBucket) {
      // Throttle, rather than debounce: a held drag keeps updating the map.
      if (!this.seekTimer)
        this.seekTimer = this.lifecycle.timeout(() => {
          this.seekTimer = undefined;
          this.loadWindow();
        }, 80);
    }
  }
  async loadWindow() {
    if (!this.cache) return;
    const id = ++this.requestId,
      bucket = Math.floor(this.clock.time / this.cache.duration);
    this.pendingBucket = bucket;
    try {
      const data = await this.cache.window(this.clock.time);
      if (id !== this.requestId) return;
      if (bucket !== Math.floor(this.clock.time / this.cache.duration)) return;
      this.engine.setPoints(data.points);
      this.events = data.events;
      this.eventRevision++;
      this.loadedBucket = bucket;
      this.status.textContent = data.points.length
        ? this.isLive
          ? "Live · local time"
          : "Historical replay · local time"
        : "No recorded data in this window";
      this.render();
      this.updateOverlays();
    } catch (error) {
      if (id === this.requestId) this.report(error);
    } finally {
      if (id === this.requestId) {
        this.pendingBucket = undefined;
        if (
          bucket !== Math.floor(this.clock.time / this.cache.duration) &&
          this.loadedBucket !== Math.floor(this.clock.time / this.cache.duration)
        )
          this.loadWindow();
      }
    }
  }
  private tickFrame(time: number): void {
    const delta = Number.isFinite(this.lastFrame)
      ? Math.max(0, Math.min(time - this.lastFrame, 1000))
      : 0;
    this.lastFrame = time;
    this.lifecycle.frame((t) => this.tickFrame(t));
    if (this.manifest && this.cache) {
      if (!this.scrubbing && this.clock.rate) {
        this.clock.tick(delta);
        this.seek(this.clock.time);
      }
      this.render();
      if (!this.lastOverlay || time - this.lastOverlay > 500) {
        this.updateOverlays();
        this.adapter?.layoutEvents();
        this.lastOverlay = time;
      }
    }
  }
  world() {
    if (!this.adapter || !this.manifest) return undefined;
    const mapId = this.adapter.mapId;
    const key = mapId ? this.integration?.mapWorlds?.[mapId] : undefined;
    return this.manifest.registry.worlds.find((world) => world.key === key)?.id;
  }
  render() {
    if (!this.manifest || !this.cache) return;
    try {
      if (!this.adapter) {
        this.adapter = new BlueMapAdapter(window.bluemap, window.BlueMap);
        const manifest = this.manifest;
        const telemetryCache = new TelemetryCache(BASE_URL, manifest.chunkDurationMs);
        this.telemetryCache = telemetryCache;
        this.adapter.stateDetails = async (player, time) =>
          describeState(
            await telemetryCache.at(player, time),
            manifest.registry,
            manifest.capabilities,
          );
        this.trailKey = this.eventKey = this.heatKey = null;
      }
      const world = this.world();
      const ready = Math.floor(this.clock.time / this.cache.duration) === this.loadedBucket;
      const positions =
        ready && !this.isLive
          ? [...this.selection]
              .map((id) => this.engine.position(id, this.clock.time))
              .filter((point): point is HistoryPoint => point !== null && point.world === world)
              .map((point) => ({ ...point, time: this.clock.time }))
          : [];
      this.adapter.setPlayers(positions, this.names);
      const healthKey = `${Math.floor(this.clock.time / 1000)}:${positions
        .map((position) => position.player)
        .join(",")}`;
      if (healthKey !== this.healthKey) {
        this.healthKey = healthKey;
        const token = {};
        this.healthToken = token;
        const telemetryCache = this.telemetryCache;
        if (!telemetryCache) return;
        Promise.all(
          positions.map(
            async (position) =>
              [position.player, await telemetryCache.at(position.player, this.clock.time)] as const,
          ),
        ).then((states) => {
          if (this.healthToken !== token || this.isLive) return;
          for (const [player, state] of states)
            this.adapter?.setPlayerVitals(player, state ?? undefined);
        });
      }
      if (world === undefined)
        this.status.textContent = "This map has no matching recorded dimension.";
      if (this.lastMap !== this.adapter.mapId) {
        this.lastMap = this.adapter.mapId;
        this.updateOverlays();
      }
    } catch (error) {
      this.report(error);
    }
  }
  updateOverlays() {
    if (!this.adapter || !this.cache || !this.manifest || !Number.isFinite(this.clock.time)) return;
    const { from, to, time } = this.clock,
      world = this.world();
    const full = this.trailMode === Infinity;
    const start = full ? from : Math.max(from, time - this.trailMode);
    const dataKey = [
      String(this.trailMode),
      this.isLive ? Math.floor(from / this.cache.duration) : from,
      this.isLive ? Math.floor(to / this.cache.duration) : to,
      full ? "full" : Math.floor(time / this.cache.duration),
    ].join(":");
    if (this.trailDataKey !== dataKey && !this.requests.pending("trails")) this.loadTrails(dataKey);
    const historyEngine = this.trailDataKey === dataKey ? this.fullTrails : null;
    const engine = this.isLive
      ? new ReplayEngine(
          mergePoints([
            { points: [...(historyEngine?.players.values() || [])].flat(), events: [] },
            { points: this.livePoints, events: [] },
          ]),
        )
      : historyEngine;
    const trailKey = [
      dataKey,
      start,
      full ? to : time,
      this.selectionRevision,
      world,
      !!engine,
      this.registryRevision,
    ].join(":");
    if (trailKey !== this.trailKey) {
      this.trailKey = trailKey;
      this.adapter.setTrails(
        this.trailMode && engine
          ? [...this.selection]
              .flatMap((id) => engine.trails(id, start, full ? to : time))
              .filter((line) => line[0]?.world === world)
          : [],
        this.names,
      );
    }
    const combined = new Map(
      [...this.rangeEvents, ...this.events, ...(this.isLive ? this.liveEvents : [])].map(
        (event) => [JSON.stringify([event.point, event.type, event.payload]), event],
      ),
    );
    const selectedTimelineEvents = [...combined.values()]
      .sort((a, b) => a.point.time - b.point.time)
      .filter(
        (event) =>
          this.selection.has(event.point.player) &&
          event.point.time >= from &&
          event.point.time <= to,
      );
    const timelineEvents = combineProductionEvents(selectedTimelineEvents).filter(
      (event) => !this.disabledEvents.has(event.type),
    );
    const events = visibleEvents(timelineEvents, {
      from,
      time,
      trailMode: this.trailMode,
      disabled: this.disabledEvents,
    }).slice(-500);
    const eventKey = [
      this.eventRevision,
      this.filterRevision,
      this.selectionRevision,
      world,
      from,
      to,
      this.registryRevision,
    ].join(":");
    if (this.eventKey !== eventKey) {
      this.eventKey = eventKey;
      this.adapter.setEvents(
        events.filter((event) => event.point.world === world),
        this.names,
        (t) => this.seek(t),
        this.manifest.registry,
      );
    }
    const chatEvents = selectedTimelineEvents
      .filter((event) => ["CHAT", "JOIN", "QUIT", "DEATH"].includes(event.type))
      .slice(-1000);
    const timelineEventKey = `${this.eventRevision}:${this.registryRevision}:${from}:${to}`;
    if (this.timelineEventKey !== timelineEventKey) {
      this.timelineEventKey = timelineEventKey;
      const chat = this.require<HTMLElement>(".history-chat");
      const follow = this.chatPinned;
      const ticks = this.require<HTMLElement>(".history-events");
      const mapRoot = window.bluemap?.mapViewer?.map?.data?.mapDataRoot;
      renderHistoryEvents(chat, ticks, {
        events: chatEvents,
        from,
        to,
        timelineWidth: ticks.clientWidth,
        names: this.names,
        players: this.manifest.registry.players,
        ...(mapRoot ? { mapRoot } : {}),
        formatTime: formatDate,
        onSelect: (event) => this.goToEvent(event),
      });
      if (follow)
        this.lifecycle.frame(() => {
          chat.scrollTop = chat.scrollHeight;
        });
    }
    const heatKey = [this.heatVersion, this.selectionRevision, world, this.heatEnabled].join(":");
    if (heatKey !== this.heatKey) {
      this.heatKey = heatKey;
      if (this.heatEnabled && this.heatRows) {
        const cells = new Map();
        for (const row of this.heatRows)
          if (this.selection.has(row[0]) && row[1] === world) {
            const key = `${row[2]},${row[3]}`,
              old = cells.get(key);
            if (old) old[4] += row[4];
            else cells.set(key, [...row]);
          }
        this.adapter.setHeatmap([...cells.values()], this.manifest.cellSize, 0.55);
      } else this.adapter.clearHeatmap();
    }
  }
  async pollLive() {
    if (!this.isConnected || this.liveLoading) return;
    this.liveLoading = true;
    const controller = this.requests.start("live");
    try {
      const data = await this.historyClient.live(controller.signal);
      if (
        !this.isConnected ||
        data.protocolVersion !== 2 ||
        !Number.isFinite(data.generatedAt) ||
        Date.now() - data.generatedAt > 10000
      )
        return;
      this.livePoints = Array.isArray(data.points) ? data.points.slice(-20000) : [];
      this.liveEvents = Array.isArray(data.events) ? data.events.slice(-1000) : [];
      this.eventRevision++;
      if (!this.manifest) await this.refresh();
      if (this.manifest && data.registry) this.manifest.registry = data.registry;
      for (const player of data.registry?.players || []) {
        if (!this.names.has(player.id)) this.selection.add(player.id);
        this.names.set(player.id, player.name);
      }
      if (this.isLive && this.manifest && this.cache) {
        this.clock.refresh(
          this.manifest.earliestTimestamp,
          Math.max(this.manifest.latestTimestamp, data.generatedAt, Date.now()),
        );
        this.clock.seek(this.clock.to);
        this.sync();
        this.render();
        this.updateOverlays();
        const bucket = Math.floor(this.clock.time / this.cache.duration);
        if (bucket !== this.loadedBucket && bucket !== this.pendingBucket) this.loadWindow();
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        this.status.textContent = "Live updates unavailable";
    } finally {
      this.requests.finish("live", controller);
      this.liveLoading = false;
    }
  }
  renderEventFilters() {
    const list = this.require<HTMLElement>(".history-event-filter-list");
    renderEventFilter(list, {
      types: this.eventTypes,
      disabled: this.disabledEvents,
      onChange: (type, visible) => {
        if (visible) this.disabledEvents.delete(type);
        else this.disabledEvents.add(type);
        this.filterRevision++;
        try {
          preferences.saveHiddenEvents(this.disabledEvents);
        } catch {}
        this.updateOverlays();
      },
    });
  }
  async loadRangeEvents() {
    if (!this.cache || !this.manifest) return;
    const controller = this.requests.start("range-events");
    const duration = this.cache.duration;
    const first = Math.floor(this.clock.from / duration) * duration;
    const last = Math.floor(this.clock.to / duration) * duration;
    const chunks = Math.floor((last - first) / duration) + 1;
    if (chunks > 5000) {
      this.rangeEvents = [];
      this.eventRevision++;
      this.status.textContent = "Event and chat history needs a range under 5,000 chunks";
      return;
    }
    const events = [];
    try {
      for (let time = first; time <= last; time += duration) {
        const data = await this.cache.read(time, controller.signal);
        events.push(...data.events);
        if (events.length > 100000) throw Error("Too many events in this range");
      }
      if (controller.signal.aborted) return;
      this.rangeEvents = events.sort((a, b) => a.point.time - b.point.time);
      this.eventRevision++;
      this.timelineEventKey = null;
      this.eventKey = null;
      this.updateOverlays();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) this.report(error);
    } finally {
      this.requests.finish("range-events", controller);
    }
  }
  async loadTrails(dataKey: string): Promise<void> {
    if (!this.cache) return;
    const cache = this.cache;
    const controller = this.requests.start("trails");
    const duration = cache.duration;
    const from =
      this.trailMode === Infinity
        ? this.clock.from
        : Math.max(
            this.clock.from,
            Math.floor(this.clock.time / duration) * duration - (this.trailMode || 30000),
          );
    const to =
      this.trailMode === Infinity
        ? this.clock.to
        : Math.min(this.clock.to, (Math.floor(this.clock.time / duration) + 1) * duration);
    const points = [],
      events = [];
    let previousPlayers = new Set();
    this.status.textContent = "Loading trails…";
    try {
      if (Math.floor(to / duration) - Math.floor(from / duration) + 1 > 5000)
        throw Error(
          "Full trails exceed 5,000 recording chunks. Choose a shorter range or 30s / 5m trails.",
        );
      for (let t = Math.floor(from / duration) * duration; t <= to; t += duration) {
        const data = await cache.read(t, controller.signal),
          seen = new Set();
        events.push(...data.events);
        if (events.length > 100000)
          throw Error("Too many events in this range. Choose a shorter trail duration.");
        for (const point of data.points) {
          seen.add(point.player);
          if (point.flags & CONTEXT && t !== Math.floor(from / duration) * duration) continue;
          points.push(
            !previousPlayers.has(point.player) ? { ...point, flags: point.flags | BREAK } : point,
          );
          previousPlayers.add(point.player);
          if (points.length > 100000)
            throw Error("Full trails exceed the browser limit. Use 30s or 5m trails.");
        }
        previousPlayers = seen;
      }
      if (controller.signal.aborted) return;
      this.trailDataKey = dataKey;
      let added = false;
      for (const event of events)
        if (!this.eventTypes.has(event.type)) {
          this.eventTypes.add(event.type);
          added = true;
        }
      if (added) this.renderEventFilters();
      this.fullTrails = new ReplayEngine(points.sort((a, b) => a.time - b.time));
      this.status.textContent = this.isLive
        ? "Live · local time"
        : "Historical replay · local time";
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        this.report(error);
        this.trailMode = 0;
        this.sync();
      }
    } finally {
      if (this.requests.current("trails", controller)) {
        if (this.fullTrails) this.updateOverlays();
      }
      this.requests.finish("trails", controller);
    }
  }
  async loadHeat(): Promise<void> {
    if (!this.manifest) return;
    const manifest = this.manifest;
    const controller = this.requests.start("heatmap");
    try {
      const plan = heatmapPlan(this.clock.from, this.clock.to, manifest.chunkDurationMs),
        cells = new Map();
      for (const part of plan) {
        for (const row of await this.historyClient.heatmap(
          part.level,
          part.time,
          controller.signal,
        )) {
          const key = row.slice(0, 4).join(":"),
            old = cells.get(key);
          if (old) old[4] += row[4];
          else cells.set(key, [...row]);
          if (cells.size > 100000) throw Error("Heatmap exceeds the browser cell limit.");
        }
      }
      if (controller.signal.aborted || !this.opened) return;
      this.heatRows = [...cells.values()];
      this.heatVersion = (this.heatVersion || 0) + 1;
      this.status.textContent = cells.size
        ? "Heatmap · time spent · completed recording chunks"
        : "No completed heatmap data in this range";
      this.updateOverlays();
    } catch (error) {
      this.report(error);
    } finally {
      this.requests.finish("heatmap", controller);
    }
  }
  disconnectedCallback(): void {
    this.lifecycle.dispose();
    this.requests.abortAll();
    this.cache?.clear();
    this.adapter?.dispose();
    this.adapter = undefined;
    this.telemetryCache = undefined;
    this.cache = undefined;
    unmountReplayPanelView(this);
  }
}
