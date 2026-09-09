import { SPEED_OPTIONS } from "../panel-options.js";
import { HistoryIcon } from "./history-icon.js";

const Shuttle = () => (
  <div class="history-shuttle-wrap">
    <div
      data-control="shuttle"
      class="history-shuttle"
      role="slider"
      tabIndex={0}
      aria-label="Hold to rewind or fast forward; release to restore playback"
      aria-valuemin={-120}
      aria-valuemax={120}
      aria-valuenow={1}
    >
      <span>−120×</span>
      <div class="history-shuttle-track">
        <i />
      </div>
      <span>120×</span>
    </div>
    <output name="rate">Shuttle · 1×</output>
  </div>
);

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
      <section class="history-events" aria-label="Events in loaded replay window" />
    </div>
    <div class="history-density-status" hidden role="status">
      Recording density · all players · 1-minute resolution
    </div>
    <div class="history-controls">
      <button type="button" name="back" title="Back five minutes" aria-label="Back five minutes">
        ↶
      </button>
      <Shuttle />
      <button
        type="button"
        name="forward"
        title="Forward five minutes"
        aria-label="Forward five minutes"
      >
        ↷
      </button>
      <button type="button" name="play" aria-label="Play replay">
        ▶
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
  </>
);
