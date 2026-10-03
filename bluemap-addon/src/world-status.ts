interface WorldStatusSample {
  dayTime: number;
  daylightCycle: boolean;
  hasSkyLight: boolean;
}

interface WorldStatusSnapshot {
  version: number;
  generatedAt: number;
  dimensions?: Record<string, WorldStatusSample>;
}

interface IntegrationMapping {
  mapWorlds?: Record<string, string>;
}

interface MapData {
  id?: string;
  skyLight?: number;
}

interface BlueMapWorldApp {
  mapViewer: {
    map?: { id?: string; data?: MapData };
    data?: {
      uniforms?: {
        sunlightStrength?: { value: number };
      };
    };
    redraw?(): void;
  };
  settings?: { useCookies?: boolean };
  loadUserSetting?(key: string, fallback: boolean): unknown;
  saveUserSetting?(key: string, value: boolean): void;
  appState?: {
    menu?: {
      currentPage(): { id?: string };
    };
  };
  events?: {
    addEventListener(type: string, listener: () => void): void;
  };
}

const POLL_MS = 1_000;
const APPLY_MS = 250;
const NIGHT_STRENGTH = 0.25;
// Preserve the preference written by the original bluemap3d-patches implementation.
const SETTING_KEY = "bluemap3d-game-time-sync";

export const dayFraction = (dayTime: number): number => {
  const time = ((dayTime % 24_000) + 24_000) % 24_000;
  if (time < 12_000) return 1;
  if (time < 13_000) return 1 - (time - 12_000) / 1_000;
  if (time < 23_000) return 0;
  return (time - 23_000) / 1_000;
};

export const sampledDayTime = (
  sample: WorldStatusSample | undefined,
  fetchedAt: number,
  now: number,
): number | null => {
  const dayTime = Number(sample?.dayTime);
  if (!Number.isFinite(dayTime)) return null;
  if (sample?.daylightCycle === false || fetchedAt <= 0) return dayTime;
  return dayTime + Math.max(0, now - fetchedAt) / 50;
};

export const formatMinecraftTime = (dayTime: number): string => {
  const timeOfDay = ((dayTime % 24_000) + 24_000) % 24_000;
  const totalMinutes = Math.floor((((timeOfDay + 6_000) % 24_000) * 1_440) / 24_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

export const minecraftDay = (dayTime: number): number => Math.floor(dayTime / 24_000) + 1;

class WorldStatusController {
  private integration?: IntegrationMapping;
  private snapshot?: WorldStatusSnapshot;
  private fetchedAt = 0;
  private loading = false;
  private enabled = true;
  private manualStrength: number | null = null;

  constructor(private readonly app: BlueMapWorldApp) {
    if (app.settings?.useCookies && typeof app.loadUserSetting === "function") {
      this.enabled = Boolean(app.loadUserSetting(SETTING_KEY, true));
    }

    this.app.events?.addEventListener("bluemapMapChanged", () => {
      if (this.enabled) this.manualStrength = this.baseSunlight();
      this.applyLighting();
      this.updateTimeDisplay();
      void this.poll();
    });

    document.addEventListener(
      "pointerdown",
      (event) => this.onManualLightingPointerDown(event),
      true,
    );

    const observer = new MutationObserver(() => {
      this.ensureTimeDisplay();
      this.ensureLightingSwitch();
    });
    observer.observe(document.getElementById("app") ?? document.body, {
      childList: true,
      subtree: true,
    });

    this.ensureLightingSwitch();
    this.ensureTimeDisplay();
    if (this.enabled) this.manualStrength = this.baseSunlight();

    void this.poll();
    window.setInterval(() => void this.poll(), POLL_MS);
    window.setInterval(() => {
      this.applyLighting();
      this.updateTimeDisplay();
    }, APPLY_MS);
  }

  private currentMap(): MapData | undefined {
    const data = this.app.mapViewer.map?.data;
    if (data) return data;
    const id = this.app.mapViewer.map?.id;
    return id ? { id } : undefined;
  }

  private currentDimension(): string | undefined {
    const map = this.currentMap();
    return map?.id ? this.integration?.mapWorlds?.[map.id] : undefined;
  }

  private currentSample(): WorldStatusSample | undefined {
    const dimension = this.currentDimension();
    return dimension ? this.snapshot?.dimensions?.[dimension] : undefined;
  }

  private interpolatedDayTime(): number | null {
    return sampledDayTime(this.currentSample(), this.fetchedAt, performance.now());
  }

  private async poll(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      if (!this.integration) {
        const integration = await fetch(
          new URL("player-history/integration.json", document.baseURI),
          { cache: "no-cache" },
        );
        if (!integration.ok) throw new Error(`integration.json HTTP ${integration.status}`);
        this.integration = (await integration.json()) as IntegrationMapping;
      }

      const response = await fetch(
        new URL("player-history/world-status.json", document.baseURI),
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`world-status.json HTTP ${response.status}`);
      const snapshot = (await response.json()) as WorldStatusSnapshot;
      if (snapshot.version !== 1) throw new Error("Unsupported world status version");
      this.snapshot = snapshot;
      this.fetchedAt = performance.now();
      this.applyLighting();
      this.updateTimeDisplay();
    } catch {
      // BlueMap and the server feed can start in either order. The next poll retries quietly.
    } finally {
      this.loading = false;
    }
  }

  private ensureTimeDisplay(): HTMLElement | null {
    const bar = document.querySelector<HTMLElement>(".control-bar");
    if (!bar) return null;

    let display = bar.querySelector<HTMLElement>(".player-history-server-time");
    if (!display) {
      display = document.createElement("div");
      display.className = "player-history-server-time";
      display.textContent = "--:--";
      display.setAttribute("aria-label", "Minecraft server time");
      const dayNight = bar.querySelector(".day-night-switch");
      const position = bar.querySelector(".pos-input");
      bar.insertBefore(display, dayNight ?? position ?? null);
    }
    return display;
  }

  private updateTimeDisplay(): void {
    const display = this.ensureTimeDisplay();
    if (!display) return;

    const dayTime = this.interpolatedDayTime();
    const dimension = this.currentDimension();
    if (dayTime === null) {
      display.textContent = "--:--";
      display.title = "Minecraft server time unavailable";
      return;
    }

    display.textContent = formatMinecraftTime(dayTime);
    display.title = `Minecraft server time · Day ${minecraftDay(dayTime)}${
      dimension ? ` · ${dimension}` : ""
    }`;
  }

  private baseSunlight(): number {
    const value = Number(this.currentMap()?.skyLight);
    return Number.isFinite(value) ? value : 1;
  }

  private setSunlight(value: number): void {
    const uniform = this.app.mapViewer.data?.uniforms?.sunlightStrength;
    if (!uniform || !Number.isFinite(value)) return;
    if (Math.abs(uniform.value - value) < 0.001) return;
    uniform.value = value;
    this.app.mapViewer.redraw?.();
  }

  private applyLighting(): void {
    if (!this.enabled) return;

    const sample = this.currentSample();
    const dayTime = this.interpolatedDayTime();
    if (!sample || dayTime === null) return;

    const base = this.baseSunlight();
    if (sample.hasSkyLight === false) {
      this.setSunlight(base);
      return;
    }

    const night = Math.min(base, NIGHT_STRENGTH);
    this.setSunlight(night + (base - night) * dayFraction(dayTime));
  }

  private saveEnabled(): void {
    if (this.app.settings?.useCookies && typeof this.app.saveUserSetting === "function") {
      this.app.saveUserSetting(SETTING_KEY, this.enabled);
    }
  }

  private setEnabled(enabled: boolean, restoreManual: boolean): void {
    if (enabled === this.enabled) {
      this.updateLightingSwitch();
      return;
    }

    if (enabled) {
      this.manualStrength = this.app.mapViewer.data?.uniforms?.sunlightStrength?.value ?? null;
      this.enabled = true;
      this.saveEnabled();
      this.applyLighting();
    } else {
      this.enabled = false;
      this.saveEnabled();
      if (restoreManual && this.manualStrength !== null) this.setSunlight(this.manualStrength);
    }
    this.updateLightingSwitch();
  }

  private lightingGroup(): HTMLElement | null {
    if (this.app.appState?.menu?.currentPage().id !== "settings") return null;

    const marked = document.querySelector<HTMLElement>(
      ".side-menu .group[data-player-history-lighting-group='true']",
    );
    if (marked) return marked;

    for (const group of document.querySelectorAll<HTMLElement>(".side-menu .group")) {
      const content = [...group.children].find((child) => child.classList.contains("content"));
      if (!(content instanceof HTMLElement)) continue;
      if (content.querySelectorAll(".slider").length !== 2) continue;
      group.dataset.playerHistoryLightingGroup = "true";
      return group;
    }
    return null;
  }

  private updateLightingSwitch(): void {
    const control = document.querySelector<HTMLButtonElement>(
      ".player-history-game-time-sync",
    );
    if (!control) return;
    control.classList.toggle("active", this.enabled);
    control.dataset.state = this.enabled ? "on" : "off";
    control.setAttribute("aria-pressed", this.enabled ? "true" : "false");
    const state = this.enabled ? "on" : "off";
    control.setAttribute("aria-label", `Server-time lighting sync ${state}`);
    control.title = `Server-time lighting sync is ${state}`;
  }

  private ensureLightingSwitch(): HTMLButtonElement | null {
    const bar = document.querySelector<HTMLElement>(".control-bar");
    if (!bar) return null;

    const time = this.ensureTimeDisplay();
    let control = bar.querySelector<HTMLButtonElement>(
      ".player-history-game-time-sync",
    );
    if (!control) {
      control = document.createElement("button");
      control.type = "button";
      control.className = "player-history-game-time-sync";
      control.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle class="time-sync-clock" cx="9" cy="13" r="5.5"></circle>
          <path class="time-sync-hands" d="M9 9.5v3.8l2.7 1.6"></path>
          <circle class="time-sync-sun" cx="17.5" cy="6" r="2"></circle>
          <path class="time-sync-rays" d="M17.5 1.8v1.2M17.5 9v1.2M13.3 6h1.2M20.5 6h1.2M14.6 3.1l.8.8M19.6 8.1l.8.8M20.4 3.1l-.8.8M15.4 8.1l-.8.8"></path>
        </svg>`;
      control.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setEnabled(!this.enabled, true);
      });
    }

    if (time && time.nextElementSibling !== control) time.after(control);
    this.updateLightingSwitch();
    return control;
  }

  private onManualLightingPointerDown(event: PointerEvent): void {
    if (!this.enabled || !(event.target instanceof Element)) return;

    if (event.target.closest(".day-night-switch")) {
      this.setEnabled(false, false);
      return;
    }

    const slider = event.target.closest(".slider");
    const group = this.lightingGroup();
    if (slider && group?.contains(slider)) this.setEnabled(false, false);
  }
}

export const startWorldStatus = async (): Promise<void> => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const app = window.bluemap as unknown as BlueMapWorldApp | undefined;
    if (app?.mapViewer) {
      new WorldStatusController(app);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  console.warn("[Player History] BlueMap web API unavailable for world status");
};
