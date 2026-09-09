import type { PlayerState } from "./types.js";

export const meterLevels = (value: unknown, maximum: unknown, limit = 20): string[] => {
  if (typeof value !== "number" || typeof maximum !== "number" || maximum <= 0) return [];
  const slots = Math.max(1, Math.min(limit, Math.ceil(maximum / 2)));
  return Array.from({ length: slots }, (_, index) => {
    const remaining = Math.max(0, Math.min(2, value - index * 2));
    return remaining >= 2 ? "full" : remaining > 0 ? "half" : "empty";
  });
};

export const createVitals = (): HTMLDivElement => {
  const vitals = document.createElement("div");
  vitals.className = "history-player-vitals";
  vitals.hidden = true;
  const health = document.createElement("div");
  health.className = "history-vital-row history-health-hearts";
  health.setAttribute("aria-label", "Health");
  vitals.append(health);
  return vitals;
};

export const renderVitals = (
  vitals: HTMLElement | null | undefined,
  state: PlayerState = {},
): void => {
  const healthRow = vitals?.querySelector<HTMLElement>(".history-health-hearts");
  if (!vitals || !healthRow) return;
  healthRow.replaceChildren();
  const health = meterLevels(state.health, state.maxHealth);
  for (const level of health) {
    const icon = document.createElement("i");
    icon.className = `heart ${level}`;
    healthRow.append(icon);
  }
  healthRow.setAttribute(
    "aria-label",
    health.length
      ? `Health ${String(state.health)} of ${String(state.maxHealth)}`
      : "Health unknown",
  );
  vitals.hidden = health.length === 0;
};
