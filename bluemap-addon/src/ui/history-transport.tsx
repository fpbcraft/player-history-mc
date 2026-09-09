import { SPEED_OPTIONS } from "../panel-options.js";
import { HistoryIcon, HistorySeekIcon } from "./history-icon.js";

const SpeedControl = () => (
  <div class="history-speed">
    <button
      name="speed-button"
      type="button"
      aria-label="Playback speed"
      title="Playback speed"
      aria-expanded="false"
    >
      <HistoryIcon name="speed" />
    </button>
    <div class="history-speed-popover history-popover history-choices" hidden>
      {SPEED_OPTIONS.map((rate) => (
        <button type="button" data-speed={rate} aria-pressed={rate === 1}>
          {rate}×
        </button>
      ))}
      <input name="speed" type="hidden" value="1" />
    </div>
  </div>
);

export const HistoryTransport = () => (
  <>
    <div class="history-dates">
      <span data-control="start">—</span>
      <span data-control="end">—</span>
    </div>
    <div class="history-playback-row">
      <div class="history-timeline">
        <div
          class="history-histogram"
          role="img"
          aria-label="Recording density across the selected range"
        />
        <input
          name="timeline"
          type="range"
          min="0"
          max="1"
          step="1"
          value="1"
          aria-label="Replay timeline"
        />
        <output class="history-tooltip" hidden />
        <div class="history-events" />
      </div>
      <div class="history-controls">
        <button type="button" name="back" title="Back five minutes" aria-label="Back five minutes">
          <HistorySeekIcon direction="back" />
        </button>
        <button type="button" name="play" aria-label="Play replay">
          ▶
        </button>
        <button
          type="button"
          name="forward"
          title="Forward five minutes"
          aria-label="Forward five minutes"
        >
          <HistorySeekIcon direction="forward" />
        </button>
        <button
          type="button"
          name="latest"
          title="Follow live events and BlueMap player positions"
          aria-label="Follow live"
        >
          NOW
        </button>
        <SpeedControl />
      </div>
    </div>
    <div class="history-density-status" hidden role="status">
      Recording density · all players · 1-minute resolution
    </div>
  </>
);
