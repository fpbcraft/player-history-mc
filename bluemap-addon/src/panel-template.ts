export const TRAIL_OPTIONS = [
  [0, "Off"],
  [30_000, "30 seconds"],
  [60_000, "1 minute"],
  [300_000, "5 minutes"],
  [900_000, "15 minutes"],
  [3_600_000, "1 hour"],
  [21_600_000, "6 hours"],
  [Infinity, "Full range"],
] as const;

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64] as const;

export const renderPanelTemplate =
  (): string => `<button name="open" aria-expanded="false" aria-controls="history-transport">◷ History</button>
<section id="history-transport" hidden aria-label="Player history">
  <div class="history-heading"><span>◷ History</span>
    <label class="history-range">Range <select name="range" aria-label="History range"><option value="0.041666666666666664">Last hour</option><option value="0.125" selected>Last 3 hours</option><option value="0.25">Last 6 hours</option><option value="1">Last 24 hours</option><option value="2">Last 48 hours</option><option value="7">Last week</option><option value="30">Last 30 days</option><option value="all">All history</option><option value="custom">Last N days…</option><option value="dates">Custom dates…</option></select></label>
    <form class="history-custom-days" hidden><label>Last <input name="days" aria-label="Number of days" type="number" min="1" max="36500" step="1" value="14" required> days</label><button type="submit">Apply</button></form>
    <output name="current">—</output><button name="compact" aria-label="Expand controls" aria-expanded="false">⌃</button><button name="close" aria-label="Close history">×</button></div>
  <form class="history-custom-dates" hidden><label>From <input name="date-from" type="datetime-local" step="1" required></label><label>To <input name="date-to" type="datetime-local" step="1" required></label><button type="submit">Apply dates</button></form>
  <div class="history-dates"><span name="start">—</span><span name="end">—</span></div>
  <div class="history-timeline"><div class="history-histogram" aria-label="Recording density across the selected range"></div><input name="timeline" type="range" min="0" max="1" step="1" value="1" aria-label="Replay timeline"><output class="history-tooltip" hidden></output><div class="history-events" aria-label="Events in loaded replay window"></div></div>
  <div class="history-density-status" hidden role="status">Recording density · all players · 1-minute resolution</div>
  <div class="history-controls">
    <button name="back" title="Back five minutes" aria-label="Back five minutes">↶</button>
    <div class="history-shuttle-wrap"><div name="shuttle" class="history-shuttle" role="slider" tabindex="0" aria-label="Hold to rewind or fast forward; release to restore playback" aria-valuemin="-120" aria-valuemax="120" aria-valuenow="1"><span>−120×</span><div class="history-shuttle-track"><i></i></div><span>120×</span></div><output name="rate">Shuttle · 1×</output></div>
    <button name="forward" title="Forward five minutes" aria-label="Forward five minutes">↷</button>
    <button name="play" aria-label="Play replay">▶</button><button name="latest" title="Follow live events and BlueMap player positions" aria-label="Follow live">NOW</button>
    <div class="history-speed"><button name="speed-button" type="button" aria-label="Playback speed" title="Playback speed" aria-expanded="false">⏱</button><div class="history-speed-popover history-popover history-choices" hidden>${SPEED_OPTIONS.map((rate) => `<button type="button" data-speed="${rate}" aria-pressed="${rate === 1}">${rate}×</button>`).join("")}<input name="speed" type="hidden" value="1"></div></div>
    <div class="history-secondary"><div class="history-trails"><button name="trails-button" aria-label="Trail duration" title="Trails" aria-expanded="false">⌁</button><div class="history-trails-popover history-popover history-choices" hidden>${TRAIL_OPTIONS.map(([value, label]) => `<button type="button" data-trail="${value}" aria-pressed="${value === 60_000}">${label}</button>`).join("")}<input name="trails" type="hidden" value="60000"></div></div>
      <div class="history-player-control"><button name="players" aria-expanded="false" aria-controls="history-players" aria-label="Filter players" title="Players">♙</button><div id="history-players" class="history-popover" hidden><div class="history-popover-heading">Players<button name="all">Select all</button></div><div class="history-player-list"></div></div></div>
      <details class="history-event-control"><summary aria-label="Event filters" title="Event filters">⚙</summary><div class="history-event-options history-popover"><div class="history-event-filter-list"></div><small>Unchecked types are hidden from this viewer.</small></div></details><button name="heat" aria-pressed="false" title="Time spent in the replay range; completed recording chunks" aria-label="Heatmap">▦</button><button name="webchat" aria-label="Web chat" title="Web chat">☏</button></div>
  </div>
  <div class="history-webchat" hidden><div class="history-webchat-feed" aria-live="polite"></div><button name="chat-connect">Connect Minecraft account</button><button name="chat-logout" hidden>Log out</button><output name="chat-status"></output><form class="history-chat-form" hidden><input name="chat-message" aria-label="Chat message" maxlength="256" placeholder="Message the server…" required><button type="submit">Send</button></form></div><div class="history-chat" aria-live="polite" aria-label="Chat history for selected range"></div><div class="history-status" role="status">Live · local time</div>
</section>
<aside class="history-chat-panel" hidden aria-label="Web chat"><div class="history-chat-heading"><strong>Chat</strong><button name="chat-close" aria-label="Close chat">×</button></div><div class="history-chat-content"></div></aside>`;

const ICONS: Record<string, string> = {
  players:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  webchat: "M21 11a8 8 0 0 1-8 8H7l-5 3V11a9 9 0 0 1 19 0Z",
  "trails-button":
    "M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M19 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4M7 17c4 0 3-10 8-10h2",
  "speed-button": "M3 18a10 10 0 1 1 18 0M12 14l5-6M5 18h14",
  heat: "M4 4h5v5H4zM10 4h5v5h-5zM16 4h4v5h-4zM4 10h5v5H4zM10 10h5v5h-5zM16 10h4v5h-4zM4 16h5v4H4zM10 16h5v4h-5zM16 16h4v4h-4z",
};

const iconMarkup = (path: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;

export const initializePanelIcons = (root: ParentNode): void => {
  for (const [name, path] of Object.entries(ICONS)) {
    const element = root.querySelector<HTMLElement>(`[name="${name}"]`);
    if (!element) throw new Error(`Missing panel control: ${name}`);
    element.innerHTML = iconMarkup(path);
  }
  const summary = root.querySelector<HTMLElement>(".history-event-control summary");
  if (!summary) throw new Error("Missing event filter summary");
  summary.innerHTML = iconMarkup(
    "M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42m0-12.72-1.42 1.42M7.06 16.94l-1.42 1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  );
};
