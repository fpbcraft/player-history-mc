export const TimeRangeControl = () => (
  <div class="history-window-selector" data-control="range-window">
    <div class="history-window-track" aria-hidden="true">
      <i />
    </div>
    <input
      name="range-start"
      type="range"
      min="0"
      max="1"
      step="1"
      value="0"
      aria-label="Replay range start"
    />
    <input
      name="range-end"
      type="range"
      min="0"
      max="1"
      step="1"
      value="1"
      aria-label="Replay range end"
    />
    <div class="history-window-labels">
      <output name="range-start-label">—</output>
      <output name="range-end-label">—</output>
    </div>
  </div>
);
