import { BlueMapAdapter } from "./bluemap-adapter.js";
import { BlueMap3DReplayAdapter } from "./bluemap3d-replay-adapter.js";
import type { BlueMapApp, BlueMapRuntime } from "./bluemap-types.js";
import { chatEventsBetween } from "./event-notifications.js";
import { ObjectChunkCache, ObjectReplayEngine } from "./object-replay.js";
import { mapConcurrent } from "./history-loading.js";
import { ChatClient, HistoryClient } from "./http-client.js";
import { type HeatmapRow, type OverlayKeys, updateReplayOverlays } from "./overlay-coordinator.js";
import { PanelControls, type ReplayControls } from "./panel-controls.js";
import { PanelLifecycle, type PanelTimer } from "./panel-lifecycle.js";
import {
  calendarRange,
  DEFAULT_DISABLED_EVENTS,
  KNOWN_EVENT_TYPES,
  RANGE_OPTIONS,
  rangeOptionLabel,
  SPEED_OPTIONS,
  TRAIL_OPTIONS,
  trailDurationLabel,
  UNAVAILABLE_EVENT_TYPES,
} from "./panel-options.js";
import { preferences } from "./preferences.js";
import { BREAK, ChunkCache, CONTEXT, heatmapPlan, OFFLINE, ReplayEngine } from "./replay-core.js";
import { createReplayPanelState, type ReplayPanelState } from "./replay-panel-state.js";
import { addActivityBins, clamp, ReplayClock } from "./replay-state.js";
import { RequestCoordinator } from "./request-coordinator.js";
import { StatusCoordinator } from "./status-coordinator.js";
import { describeState, eventDetails, TelemetryCache } from "./telemetry.js";
import { formatDate } from "./time-format.js";
import type {
  HistoryEvent,
  HistoryManifest,
  HistoryPoint,
  IntegrationMapping,
  ObjectHistoryManifest,
} from "./types.js";
import { renderActivityHistogram } from "./ui/activity-histogram-view.js";
import { type ChatNotification, renderChatNotifications } from "./ui/chat-notification-view.js";
import { renderEventFilter } from "./ui/event-filter-view.js";
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
  private objectAdapter: BlueMap3DReplayAdapter | undefined;
  private objectManifest: ObjectHistoryManifest | undefined;
  private objectCache: ObjectChunkCache | undefined;
  private objectEngine = new ObjectReplayEngine(32, 32767);
  private objectLoadedBucket: number | undefined;
  private fullTrails: ReplayEngine | null = null;
  private heatRows: HeatmapRow[] | null = null;
  private statusCoordinator!: StatusCoordinator;
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
  private heatVersion = 0;
  private chatTimer: PanelTimer | undefined;
  private seekTimer: PanelTimer | undefined;
  private trailDataKey: string | null = null;
  private healthKey: string | null = null;
  private overlayKeys: OverlayKeys = {
    event: null,
    heat: null,
    timeline: null,
    trail: null,
  };
  private eventRevision = 0;
  private registryRevision = 0;
  private selectionRevision = 0;
  private filterRevision = 0;
  private healthToken: object = {};
  private trailMode = 60_000;
  private chatNotifications: ChatNotification[] = [];
  private seenLiveChatEvents = new Set<string>();
  private liveChatInitialized = false;

  private setTrailProgress(completed: number, total: number): void {
    if (total <= 0) return;
    const percent = Math.min(100, Math.round((completed / total) * 100));
    this.statusCoordinator.show("loading", `Loading trails… ${percent}%`);
  }

  private loadingConcurrency(): number {
    if (this.mobileQuery.matches) return 2;
    return Math.min(4, Math.max(2, navigator.hardwareConcurrency || 2));
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
    this.overlayKeys = { event: null, heat: null, timeline: null, trail: null };
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
      RANGE_OPTIONS.some(([value]) => value === savedRange)
    )
      this.q("range").value = savedRange;
    const savedDays = preferences.days();
    if (savedDays !== null && Number.isInteger(savedDays) && savedDays > 0 && savedDays <= 36500)
      this.q("days").value = String(savedDays);
    const initialRange = this.q("range").value;
    if (initialRange === "all") this.clock.rangeDuration = Infinity;
    else if (!calendarRange(initialRange, Date.now()))
      this.clock.rangeDuration =
        Number(initialRange === "custom" ? this.q("days").value : initialRange) * 86400000;
    const savedSpeed = preferences.speed();
    if (savedSpeed !== null && SPEED_OPTIONS.includes(savedSpeed as (typeof SPEED_OPTIONS)[number]))
      this.clock.playbackRate = savedSpeed;
    this.isLive = true;
    this.liveEvents = [];
    this.livePoints = [];
    this.chatNotifications = [];
    this.seenLiveChatEvents = new Set();
    this.liveChatInitialized = false;
    this.mobileQuery = matchMedia("(max-width: 600px)");
    this.engine = new ReplayEngine();
    this.objectEngine = new ObjectReplayEngine(32, 32767);
    this.objectLoadedBucket = undefined;
    this.names = new Map();
    this.selection = new Set();
    try {
      const selected = preferences.players();
      if (selected !== null) {
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
    for (const type of UNAVAILABLE_EVENT_TYPES) this.disabledEvents.add(type);
    this.eventTypes = new Set(KNOWN_EVENT_TYPES);
    this.renderEventFilters();
    const savedTrail = String(preferences.trails());
    this.trailMode = savedTrail === "Infinity" ? Infinity : Number(savedTrail ?? 60000);
    if (!TRAIL_OPTIONS.some(([value]) => Object.is(value, this.trailMode))) this.trailMode = 60000;
    this.heatEnabled = preferences.heatmap();
    this.chatPinned = true;
    this.rangeEvents = [];
    this.requestId = 0;
    this.statusCoordinator = new StatusCoordinator(this.require<HTMLElement>(".history-status"));
    this.chatClient = new ChatClient(() => this.chatToken);
    this.chatToken = preferences.chatToken();
    this.q("webchat").onclick = () => this.openChat();
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
    const rangeMenu = this.require<HTMLElement>(".history-range-popover");
    rangeMenu.setAttribute("popover", "manual");
    this.q("range-button").onclick = () => {
      const open = rangeMenu.hidden;
      this.closeChoices();
      if (open) {
        const local = (time: number) =>
          new Date(time - new Date(time).getTimezoneOffset() * 60000).toISOString().slice(0, 19);
        if (this.manifest) {
          this.q("date-from").value = local(this.clock.from);
          this.q("date-to").value = local(this.clock.to);
        }
        this.showRangeEditor(
          this.q("range").value === "custom" || this.q("range").value === "dates"
            ? this.q("range").value
            : null,
        );
        this.showMenu(rangeMenu, this.q("range-button"), true);
      }
    };
    rangeMenu.querySelectorAll<HTMLButtonElement>("[data-range]").forEach((button) => {
      button.onclick = () => {
        const value = button.dataset.range ?? "0.125";
        if (value === "custom" || value === "dates") {
          this.showRangeEditor(value);
          this.showMenu(rangeMenu, this.q("range-button"), true);
          return;
        }
        this.q("range").value = value;
        this.closeChoices();
        void this.changeRange();
      };
    });
    this.require<HTMLFormElement>(".history-custom-days").onsubmit = (event) => {
      event.preventDefault();
      this.q("range").value = "custom";
      this.closeChoices();
      void this.changeRange();
    };
    this.require<HTMLFormElement>(".history-custom-dates").onsubmit = (event) => {
      event.preventDefault();
      this.q("range").value = "dates";
      void this.changeRange().then(() => this.closeChoices());
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
      void this.setHeatmapOverlay(!this.heatEnabled);
    };
    document.addEventListener(
      "player-history:heatmap-toggle",
      (event) => {
        const enabled = Boolean(
          (event as CustomEvent<{ enabled?: boolean }>).detail?.enabled,
        );
        void this.setHeatmapOverlay(enabled);
      },
      { signal: this.lifecycle.signal },
    );
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
        if (
          !this.require<HTMLElement>(".history-range").contains(
            event.target instanceof Node ? event.target : null,
          )
        ) {
          rangeMenu.hidePopover?.();
          rangeMenu.hidden = true;
          this.q("range-button").setAttribute("aria-expanded", "false");
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
          this.q("players").focus();
        }
      },
      { signal: this.lifecycle.signal },
    );
    window.addEventListener("blur", finishScrub, { signal: this.lifecycle.signal });
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
    this.restoreVisibility();
    this.sync();
    this.lifecycle.frame((time) => this.tickFrame(time));
    const startLivePolling = () => {
      void this.pollLive();
      this.lifecycle.interval(() => this.pollLive(), 1000);
    };
    void this.refresh(true).then(startLivePolling);
    this.lifecycle.interval(() => {
      if (this.opened || this.heatEnabled) void this.refresh();
    }, 45000);
  }
  private async setHeatmapOverlay(enabled: boolean): Promise<void> {
    this.heatEnabled = enabled;
    preferences.saveHeatmap(enabled);
    this.requests.abort("heatmap");
    this.sync();
    this.updateOverlays();
    document.dispatchEvent(
      new CustomEvent("player-history:heatmap-state", { detail: { enabled } }),
    );
    if (!enabled) return;
    if (!this.manifest) await this.refresh(true);
    else await this.loadHeat();
  }

  closeChoices() {
    this.require<HTMLDetailsElement>(".history-event-control").open = false;
    for (const kind of ["speed", "trails"] as const) {
      const menu = this.require<HTMLElement>(`.history-${kind}-popover`);
      menu.hidePopover?.();
      menu.hidden = true;
      this.q(`${kind}-button`).setAttribute("aria-expanded", "false");
    }
    const rangeMenu = this.require<HTMLElement>(".history-range-popover");
    rangeMenu.hidePopover?.();
    rangeMenu.hidden = true;
    this.q("range-button").setAttribute("aria-expanded", "false");
  }

  private showRangeEditor(kind: string | null): void {
    const menu = this.require<HTMLElement>(".history-range-popover");
    const editor = this.require<HTMLElement>(".history-absolute-range");
    const dates = menu.querySelectorAll<HTMLElement>(".history-custom-dates");
    const days = menu.querySelectorAll<HTMLElement>(".history-custom-days");
    const editingDates = kind === "dates";
    const editingDays = kind === "custom";
    editor.hidden = !editingDates && !editingDays;
    menu.classList.toggle("history-range-editor-open", !editor.hidden);
    for (const element of dates) element.hidden = !editingDates;
    for (const element of days) element.hidden = !editingDays;
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
    preferences.saveHistoryOpen(true);
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
  async openChat() {
    const box = this.require<HTMLElement>(".history-chat-panel");
    box.hidden = false;
    preferences.saveChatOpen(true);
    this.q("webchat").hidden = true;
    this.q("webchat").setAttribute("aria-expanded", "true");
    this.clearChatNotifications();
    if (this.mobileQuery.matches) {
      if (this.opened) this.close();
      this.q("open").hidden = true;
    }
    await this.loadRangeEvents();
    this.updateOverlays();
    this.lifecycle.clearInterval(this.chatTimer);
    this.pollChat();
    this.chatTimer = this.lifecycle.interval(() => this.pollChat(), 2000);
  }
  close() {
    this.closeChoices();
    this.opened = false;
    preferences.saveHistoryOpen(false);
    this.lifecycle.clearInterval(this.chatTimer);
    this.clock.isPlaying = false;
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
    preferences.saveChatOpen(false);
    this.q("webchat").hidden = false;
    this.q("webchat").setAttribute("aria-expanded", "false");
    if (this.mobileQuery.matches && !this.opened) this.q("open").hidden = false;
  }
  private restoreVisibility(): void {
    const chatOpen = preferences.chatOpen();
    const historyOpen = preferences.historyOpen() && !(this.mobileQuery.matches && chatOpen);
    this.opened = historyOpen;
    this.require<HTMLElement>("section").hidden = !historyOpen;
    this.q("open").hidden = historyOpen || (this.mobileQuery.matches && chatOpen);
    this.q("open").setAttribute("aria-expanded", String(historyOpen));
    this.require<HTMLElement>(".history-chat-panel").hidden = !chatOpen;
    this.q("webchat").hidden = chatOpen || (this.mobileQuery.matches && historyOpen);
    this.q("webchat").setAttribute("aria-expanded", String(chatOpen));
    if (!chatOpen) return;
    this.pollChat();
    this.chatTimer = this.lifecycle.interval(() => this.pollChat(), 2_000);
  }
  private clearChatNotifications(): void {
    this.chatNotifications = [];
    renderChatNotifications(
      this.require<HTMLElement>(".history-chat-notifications"),
      this.chatNotifications,
      () => void this.openChat(),
    );
  }

  private notifyLiveChat(event: HistoryEvent, registry = this.manifest?.registry): void {
    if (!this.require<HTMLElement>(".history-chat-panel").hidden) return;
    const player = registry?.players.find((candidate) => candidate.id === event.point.player);
    const mapRoot = window.bluemap?.mapViewer?.map?.data?.mapDataRoot;
    const id = `${event.point.player}:${event.point.time}:${JSON.stringify(event.payload)}`;
    this.chatNotifications = [
      ...this.chatNotifications,
      {
        id,
        ...(player?.uuid && mapRoot
          ? { head: `${mapRoot}/assets/playerheads/${player.uuid}.png` }
          : {}),
        message: eventDetails(event.payload, {}, "CHAT"),
        name: player?.name ?? this.names.get(event.point.player) ?? "Player",
        time: formatDate(event.point.time, false),
      },
    ].slice(-4);
    const root = this.require<HTMLElement>(".history-chat-notifications");
    const renderNotifications = () =>
      renderChatNotifications(root, this.chatNotifications, () => void this.openChat());
    renderNotifications();
    this.lifecycle.timeout(() => {
      this.chatNotifications = this.chatNotifications.filter((item) => item.id !== id);
      renderNotifications();
    }, 7_000);
  }

  private notifyPlaybackChats(from: number, to: number): void {
    if (this.disabledEvents.has("CHAT")) return;
    const seen = new Set<string>();
    for (const event of [
      ...chatEventsBetween(this.rangeEvents, from, to, this.selection),
      ...chatEventsBetween(this.liveEvents, from, to, this.selection),
    ]) {
      const key = `${event.point.player}:${event.point.time}:${JSON.stringify(event.payload)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.notifyLiveChat(event);
    }
  }
  goNow() {
    this.isLive = true;
    this.clock.isPlaying = false;
    if (this.clock.customRange) {
      this.clock.customRange = null;
      const savedRange = preferences.range() || "0.125";
      this.q("range").value = ["dates", "yesterday"].includes(savedRange) ? "0.125" : savedRange;
    }
    if (this.manifest) {
      const latest = Math.max(this.manifest.latestTimestamp, Date.now());
      const calendar = calendarRange(this.q("range").value, latest);
      if (calendar) this.clock.customRange = { from: calendar.from, to: calendar.to };
      this.clock.refresh(this.manifest.earliestTimestamp, latest, true);
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

      if (this.opened) {
        const objectManifest = await this.historyClient.objectManifest(controller.signal);
        this.objectManifest = objectManifest ?? undefined;
        if (objectManifest) {
          if (
            !this.objectCache ||
            this.objectCache.duration !== objectManifest.chunkDurationMs
          ) {
            this.objectCache?.clear();
            this.objectCache = new ObjectChunkCache(
              new URL("data/objects", BASE_URL).href,
              objectManifest.chunkDurationMs,
              undefined,
              objectManifest.chunkRanges,
            );
            this.objectEngine = new ObjectReplayEngine(
              objectManifest.positionScale,
              objectManifest.quaternionScale,
            );
            this.objectLoadedBucket = undefined;
          }
          this.objectCache.setAvailableRanges(objectManifest.chunkRanges);
        } else {
          this.objectCache?.clear();
          this.objectCache = undefined;
          this.objectLoadedBucket = undefined;
          this.objectEngine.setPoints([]);
          this.objectAdapter?.clear();
        }
      }
      if (!this.cache || this.cache.duration !== m.chunkDurationMs) {
        this.cache?.clear();
        this.cache = new ChunkCache(
          new URL("data", BASE_URL).href,
          m.chunkDurationMs,
          undefined,
          m.chunkRanges,
        );
      }
      this.cache.setAvailableRanges(m.chunkRanges);
      for (const player of m.registry.players) {
        if (!this.hasSavedSelection && !this.names.has(player.id)) this.selection.add(player.id);
      }
      this.names = new Map(m.registry.players.map((player) => [player.id, player.name]));
      this.selection = new Set([...this.selection].filter((id) => this.names.has(id)));
      this.registryRevision++;
      this.selectionRevision++;
      const latest = Math.max(m.latestTimestamp, Date.now());
      const calendar = calendarRange(this.q("range").value, latest);
      if (calendar) this.clock.customRange = { from: calendar.from, to: calendar.to };
      this.clock.refresh(m.earliestTimestamp, latest, reset);
      this.renderPlayers();
      if (changed) await this.reloadRange();
      else if (this.opened) this.loadActivity();
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
      this.statusCoordinator.show("error", errorMessage(error));
  }
  async changeRange() {
    const choice = this.q("range").value;
    if (choice === "custom" && !this.q("days").reportValidity()) return;
    const latest = Math.max(this.manifest?.latestTimestamp ?? 0, Date.now());
    const calendar = calendarRange(choice, latest);
    if (calendar) {
      this.clock.customRange = { from: calendar.from, to: calendar.to };
      this.isLive = calendar.followsLive;
    } else if (choice === "dates") {
      this.isLive = false;
      const from = new Date(this.q("date-from").value).getTime(),
        to = new Date(this.q("date-to").value).getTime();
      if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
        this.statusCoordinator.show("range", "Choose an end date after the start date.");
        return;
      }
      this.clock.customRange = { from, to };
    } else {
      this.clock.customRange = null;
      this.isLive = true;
    }
    if (!calendar && choice !== "dates")
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
    if (!this.manifest?.activityBucketMs) {
      chart.replaceChildren();
      caption.textContent = "Recording density is not available yet";
      this.requests.finish("activity", controller);
      return;
    }
    const count = Math.max(12, Math.min(96, Math.floor((chart.clientWidth || 720) / 10)));
    const bins = Array(count).fill(0),
      day = 86400000;
    const first = Math.floor(from / day) * day,
      last = Math.floor(to / day) * day;
    if ((last - first) / day > 2000) {
      chart.replaceChildren();
      caption.textContent = "Choose a range of up to 2,000 days to show recording density";
      this.requests.finish("activity", controller);
      return;
    }
    caption.textContent = "Loading recording density…";
    try {
      const starts = Array.from(
        { length: Math.floor((last - first) / day) + 1 },
        (_, index) => first + index * day,
      );
      const days = await mapConcurrent(starts, this.loadingConcurrency(), (start) =>
        this.historyClient.activity(start, controller.signal),
      );
      for (const rows of days) {
        addActivityBins(bins, rows, from, to);
      }
      if (!this.requests.current("activity", controller) || !this.opened) return;
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
    if (this.opened) this.loadActivity();
    else this.requests.abort("activity");
    if (!this.cache) return;
    this.cache.clear();
    this.objectCache?.clear();
    this.objectEngine.setPoints([]);
    this.objectLoadedBucket = undefined;
    this.objectAdapter?.clear();
    this.requestId++;
    this.pendingBucket = this.loadedBucket = undefined;
    this.fullTrails = null;
    this.trailDataKey = null;
    this.requests.abort("trails");
    this.requests.abort("heatmap");
    this.heatRows = null;
    this.overlayKeys = { event: null, heat: null, timeline: null, trail: null };
    if (this.opened) {
      this.loadRangeEvents();
      await this.loadWindow();
    } else {
      this.rangeEvents = [];
    }
    this.updateOverlays();
    if (this.heatEnabled) void this.loadHeat();
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
    const rangeLabel = rangeOptionLabel(this.q("range").value);
    this.q("range-label").textContent = rangeLabel;
    this.q("range-button").title = `History range: ${rangeLabel}`;
    this.q("range-button").setAttribute("aria-label", `Choose history range · ${rangeLabel}`);
    this.require<HTMLElement>(".history-range-options")
      .querySelectorAll<HTMLButtonElement>("[data-range]")
      .forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.range === this.q("range").value));
      });
    // Keep the visual control identical at every breakpoint; the accessible
    // label carries the full action name.
    this.q("play").textContent = c.isPlaying ? "Ⅱ" : "▶";
    this.q("play").setAttribute("aria-label", c.isPlaying ? "Pause replay" : "Play replay");
    const playerCount = this.selection.size;
    this.q("player-count").textContent = String(playerCount);
    this.q("players").title = `Players · ${playerCount} selected`;
    this.q("players").setAttribute("aria-label", `Filter players · ${playerCount} selected`);
    this.q("trails").value = String(this.trailMode);
    const trailLabel = trailDurationLabel(this.trailMode);
    this.q("trail-label").textContent = trailLabel;
    this.q("trails-button").title = `Trails · ${trailLabel}`;
    this.q("trails-button").setAttribute("aria-label", `Trail duration · ${trailLabel}`);
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
      const objectTime = this.clock.time;
      const [data, objectPoints] = await Promise.all([
        this.cache.window(objectTime),
        this.objectCache?.window(objectTime) ?? Promise.resolve([]),
      ]);
      if (id !== this.requestId) return;
      if (bucket !== Math.floor(this.clock.time / this.cache.duration)) return;
      this.engine.setPoints(data.points);
      if (this.objectCache) {
        this.objectEngine.setPoints(objectPoints);
        this.objectLoadedBucket = Math.floor(objectTime / this.objectCache.duration);
      } else {
        this.objectEngine.setPoints([]);
        this.objectLoadedBucket = undefined;
      }
      this.events = data.events;
      this.eventRevision++;
      this.loadedBucket = bucket;
      this.statusCoordinator.show(
        "context",
        data.points.length
          ? this.isLive
            ? "Live · local time"
            : "Historical replay · local time"
          : "No recorded data in this window",
      );
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
        const previousTime = this.clock.time;
        this.clock.tick(delta);
        this.notifyPlaybackChats(previousTime, this.clock.time);
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
  private worldKey(): string | undefined {
    if (!this.adapter) return undefined;
    const mapId = this.adapter.mapId;
    return mapId ? this.integration?.mapWorlds?.[mapId] : undefined;
  }
  world() {
    if (!this.manifest) return undefined;
    const key = this.worldKey();
    return this.manifest.registry.worlds.find((world) => world.key === key)?.id;
  }
  private objectWorld(): number | undefined {
    const key = this.worldKey();
    if (!key || !this.objectManifest) return undefined;
    const index = this.objectManifest.registry.worlds.indexOf(key);
    return index >= 0 ? index : undefined;
  }
  render() {
    if (!this.manifest || !this.cache) return;
    try {
      if (!this.adapter) {
        this.adapter = new BlueMapAdapter(window.bluemap, window.BlueMap);
        this.objectAdapter = new BlueMap3DReplayAdapter(window.BlueMap);
        const manifest = this.manifest;
        const telemetryCache = new TelemetryCache(BASE_URL, manifest.chunkDurationMs);
        this.telemetryCache = telemetryCache;
        this.adapter.stateDetails = async (player, time) =>
          describeState(
            await telemetryCache.at(player, time),
            manifest.registry,
            manifest.capabilities,
          );
        this.overlayKeys = { event: null, heat: null, timeline: null, trail: null };
      }
      const world = this.world();
      const ready = Math.floor(this.clock.time / this.cache.duration) === this.loadedBucket;
      let positions: HistoryPoint[] = [];
      if (this.isLive) {
        const latest = new Map<number, HistoryPoint>();
        for (const point of this.livePoints) {
          if (point.world !== world || !this.selection.has(point.player)) continue;
          const previous = latest.get(point.player);
          if (!previous || point.time >= previous.time) latest.set(point.player, point);
        }
        positions = [...latest.values()].filter((point) => !(point.flags & OFFLINE));
      } else if (ready) {
        positions = [...this.selection]
          .map((id) => this.engine.position(id, this.clock.time))
          .filter((point): point is HistoryPoint => point !== null && point.world === world)
          .map((point) => ({ ...point, time: this.clock.time }));
      }
      this.adapter.setPlayers(positions, this.names, this.manifest.registry.players);

      if (this.objectAdapter && this.objectManifest && this.objectCache && !this.isLive) {
        const objectWorld = this.objectWorld();
        const objectReady =
          Math.floor(this.clock.time / this.objectCache.duration) === this.objectLoadedBucket;
        this.objectAdapter.setObjects(
          objectReady && objectWorld !== undefined
            ? this.objectEngine.poses(this.clock.time, objectWorld)
            : [],
          this.objectManifest.registry.objects,
          this.objectManifest.geometries ?? [],
          new URL("data/objects/", BASE_URL).href,
        );
      } else {
        this.objectAdapter?.clear();
      }
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
        this.statusCoordinator.show("range", "This map has no matching recorded dimension.");
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
    const chat = this.require<HTMLElement>(".history-chat");
    const timeline = this.require<HTMLElement>(".history-events");
    this.overlayKeys = updateReplayOverlays({
      adapter: this.adapter,
      cache: this.cache,
      clock: this.clock,
      disabledEvents: this.disabledEvents,
      events: this.events,
      eventRevision: this.eventRevision,
      filterRevision: this.filterRevision,
      fullTrails: this.fullTrails,
      heatEnabled: this.heatEnabled,
      heatRows: this.heatRows,
      heatVersion: this.heatVersion,
      isLive: this.isLive,
      liveEvents: this.liveEvents,
      livePoints: this.livePoints,
      manifest: this.manifest,
      names: this.names,
      ...(window.bluemap?.mapViewer?.map?.data?.mapDataRoot
        ? { mapRoot: window.bluemap.mapViewer.map.data.mapDataRoot }
        : {}),
      registryRevision: this.registryRevision,
      rangeEvents: this.rangeEvents,
      selection: this.selection,
      selectionRevision: this.selectionRevision,
      chatPinned: this.chatPinned,
      timelineRoot: timeline,
      chatRoot: chat,
      trailDataKey: this.trailDataKey,
      trailMode: this.opened ? this.trailMode : 0,
      world: this.world(),
      keys: this.overlayKeys,
      timelineWidth: timeline.clientWidth,
      requestTrail: (dataKey) => this.loadTrails(dataKey),
      trailPending: this.requests.pending("trails"),
      schedule: (callback) => this.lifecycle.frame(callback),
      onSelectEvent: (event) => this.goToEvent(event),
      onSeek: (time) => this.seek(time),
    });
    return;
  }
  async pollLive() {
    if (!this.isConnected || this.liveLoading) return;
    this.liveLoading = true;
    const controller = this.requests.start("live");
    try {
      const data = this.opened
        ? await this.historyClient.live(controller.signal)
        : await this.historyClient.presence(controller.signal);
      if (
        !this.isConnected ||
        data.protocolVersion !== 2 ||
        !Number.isFinite(data.generatedAt) ||
        Date.now() - data.generatedAt > 10000
      )
        return;
      this.livePoints = Array.isArray(data.points) ? data.points.slice(-20000) : [];
      this.liveEvents = Array.isArray(data.events) ? data.events.slice(-1000) : [];
      for (const event of this.liveEvents) {
        if (event.type !== "CHAT") continue;
        const key = `${event.point.player}:${event.point.time}:${JSON.stringify(event.payload)}`;
        if (this.liveChatInitialized && !this.seenLiveChatEvents.has(key))
          this.notifyLiveChat(event, data.registry);
        this.seenLiveChatEvents.add(key);
      }
      while (this.seenLiveChatEvents.size > 2_000) {
        const oldest = this.seenLiveChatEvents.values().next().value;
        if (oldest === undefined) break;
        this.seenLiveChatEvents.delete(oldest);
      }
      this.liveChatInitialized = true;
      this.eventRevision++;
      if (!this.manifest && (this.opened || this.heatEnabled)) await this.refresh();
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
        if (
          this.opened &&
          bucket !== this.loadedBucket &&
          bucket !== this.pendingBucket
        )
          void this.loadWindow();
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        this.statusCoordinator.show("error", "Live updates unavailable");
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
    const cache = this.cache;
    const controller = this.requests.start("range-events");
    const starts = cache.chunkStarts(this.clock.from, this.clock.to, 5000);
    if (starts.length > 5000) {
      this.rangeEvents = [];
      this.eventRevision++;
      this.statusCoordinator.show(
        "range",
        "Event and chat history needs a range under 5,000 chunks",
      );
      return;
    }
    const events = [];
    try {
      const chunks = await mapConcurrent(starts, this.loadingConcurrency(), (time) =>
        cache.read(time, controller.signal),
      );
      for (const data of chunks) {
        events.push(...data.events);
        if (events.length > 100000) throw Error("Too many events in this range");
      }
      if (controller.signal.aborted) return;
      this.rangeEvents = events.sort((a, b) => a.point.time - b.point.time);
      this.eventRevision++;
      this.overlayKeys.timeline = null;
      this.overlayKeys.event = null;
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
    try {
      const starts = cache.chunkStarts(from, to, 5000);
      this.statusCoordinator.show("loading", `Loading trails… ${starts.length ? "0" : "100"}%`);
      if (starts.length > 5000)
        throw Error(
          "Full trails exceed 5,000 recording chunks. Choose a shorter range or 30s / 5m trails.",
        );
      const chunks = await mapConcurrent(
        starts,
        this.loadingConcurrency(),
        (time) => cache.read(time, controller.signal),
        (completed, total) => this.setTrailProgress(completed, total),
      );
      let previousStart: number | undefined;
      for (let index = 0; index < chunks.length; index++) {
        const data = chunks[index];
        const t = starts[index];
        if (!data || t === undefined) continue;
        if (previousStart !== undefined && t !== previousStart + duration)
          previousPlayers = new Set();
        const seen = new Set<number>();
        events.push(...data.events);
        if (events.length > 100000)
          throw Error("Too many events in this range. Choose a shorter trail duration.");
        for (const point of data.points) {
          seen.add(point.player);
          if (point.flags & CONTEXT && t !== starts[0]) continue;
          points.push(
            !previousPlayers.has(point.player) ? { ...point, flags: point.flags | BREAK } : point,
          );
          previousPlayers.add(point.player);
          if (points.length > 100000)
            throw Error("Full trails exceed the browser limit. Use 30s or 5m trails.");
        }
        previousPlayers = seen;
        previousStart = t;
      }
      if (controller.signal.aborted) return;
      this.trailDataKey = dataKey;
      let added = false;
      for (const event of events)
        if (
          !UNAVAILABLE_EVENT_TYPES.includes(
            event.type as (typeof UNAVAILABLE_EVENT_TYPES)[number],
          ) &&
          !this.eventTypes.has(event.type)
        ) {
          this.eventTypes.add(event.type);
          added = true;
        }
      if (added) this.renderEventFilters();
      this.fullTrails = new ReplayEngine(points.sort((a, b) => a.time - b.time));
      this.statusCoordinator.show(
        "context",
        this.isLive ? "Live · local time" : "Historical replay · local time",
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        this.report(error);
        this.trailMode = 0;
        this.sync();
      }
    } finally {
      if (this.requests.current("trails", controller)) {
        this.statusCoordinator.clear("loading");
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
      if (controller.signal.aborted) return;
      this.heatRows = [...cells.values()];
      this.heatVersion = (this.heatVersion || 0) + 1;
      this.statusCoordinator.show(
        "context",
        cells.size
          ? "Heatmap · time spent · completed recording chunks"
          : "No completed heatmap data in this range",
      );
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
    this.objectCache?.clear();
    this.objectAdapter?.dispose();
    this.objectAdapter = undefined;
    this.adapter?.dispose();
    this.adapter = undefined;
    this.telemetryCache = undefined;
    this.cache = undefined;
    this.objectCache = undefined;
    this.objectManifest = undefined;
    this.objectLoadedBucket = undefined;
    unmountReplayPanelView(this);
  }
}
