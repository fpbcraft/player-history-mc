import { RANGE_OPTIONS, TRAIL_OPTIONS } from "../panel-options.js";
import { HistoryIcon } from "./history-icon.js";

const TrailControl = () => (
  <div class="history-trails">
    <button
      type="button"
      name="trails-button"
      aria-label="Trail duration"
      title="Trails"
      aria-expanded="false"
    >
      <HistoryIcon name="trails" />
      <span class="history-tool-value" data-control="trail-label">
        1m
      </span>
    </button>
    <div class="history-trails-popover history-popover history-choices" hidden>
      {TRAIL_OPTIONS.map(([value, label]) => (
        <button type="button" data-trail={value} aria-pressed={value === 60_000}>
          {label}
        </button>
      ))}
      <input name="trails" type="hidden" value="60000" />
    </div>
  </div>
);

const HeaderTools = () => (
  <div class="history-header-tools">
    <TrailControl />
    <div class="history-player-control">
      <button
        type="button"
        name="players"
        aria-expanded="false"
        aria-controls="history-players"
        aria-label="Filter players"
        title="Players"
      >
        <HistoryIcon name="players" />
        <span class="history-tool-value" data-control="player-count">
          0
        </span>
      </button>
      <div id="history-players" class="history-popover" hidden>
        <div class="history-popover-heading">
          Players
          <button type="button" name="all">
            Select all
          </button>
        </div>
        <div class="history-player-list" />
      </div>
    </div>
    <button
      type="button"
      name="heat"
      aria-pressed="false"
      title="Time spent in the replay range; completed recording chunks"
      aria-label="Heatmap"
    >
      <HistoryIcon name="heat" />
    </button>
    <details class="history-event-control">
      <summary aria-label="Event filters" title="Event filters">
        <HistoryIcon name="events" />
      </summary>
      <div class="history-event-options history-popover">
        <div class="history-event-filter-list" />
        <small>Unchecked types are hidden from this viewer.</small>
      </div>
    </details>
  </div>
);

export const HistoryHeader = () => (
  <>
    <div class="history-heading">
      <span>◷ History</span>
      <label class="history-range">
        Range
        <select name="range" aria-label="History range">
          {RANGE_OPTIONS.map(([value, label]) => (
            <option value={value} selected={value === "0.125"}>
              {label}
            </option>
          ))}
          <option value="selection" hidden>
            Selected range
          </option>
        </select>
      </label>
      <form class="history-custom-days" hidden>
        <label>
          Last
          <input
            name="days"
            aria-label="Number of days"
            type="number"
            min="1"
            max="36500"
            step="1"
            value="14"
            required
          />
          days
        </label>
        <button type="submit">Apply</button>
      </form>
      <output name="current">—</output>
      <HeaderTools />
      <button type="button" name="compact" aria-label="Expand controls" aria-expanded="false">
        ⌃
      </button>
      <button type="button" name="close" aria-label="Close history">
        ×
      </button>
    </div>
    <form class="history-custom-dates" hidden>
      <label>
        From <input name="date-from" type="datetime-local" step="1" required />
      </label>
      <label>
        To <input name="date-to" type="datetime-local" step="1" required />
      </label>
      <button type="submit">Apply dates</button>
    </form>
  </>
);
