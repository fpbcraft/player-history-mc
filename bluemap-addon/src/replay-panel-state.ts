export interface ReplayPanelState {
  panel: "closed" | "open";
  mode: "historical" | "live";
  scrubbing: boolean;
  heatmap: boolean;
  chatPinned: boolean;
  chatLoading: boolean;
  liveLoading: boolean;
  refreshing: boolean;
  hasSavedSelection: boolean;
}

export const createReplayPanelState = (): ReplayPanelState => ({
  panel: "closed",
  mode: "live",
  scrubbing: false,
  heatmap: false,
  chatPinned: true,
  chatLoading: false,
  liveLoading: false,
  refreshing: false,
  hasSavedSelection: false,
});
