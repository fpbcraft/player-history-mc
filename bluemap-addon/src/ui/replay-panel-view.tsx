import { render } from "preact";
import { HistoryIcon } from "./history-icon.js";
import { HistoryChat } from "./history-chat.js";
import { HistoryHeader } from "./history-header.js";
import { HistoryTransport } from "./history-transport.js";

const ReplayPanelView = () => (
  <>
    <button type="button" name="open" aria-expanded="false" aria-controls="history-transport">
      <HistoryIcon name="time" /> History
    </button>
    <section id="history-transport" hidden aria-label="Player history">
      <HistoryHeader />
      <HistoryTransport />
      <div class="history-status" role="status">
        Live · local time
      </div>
    </section>
    <HistoryChat />
  </>
);

export const mountReplayPanelView = (root: HTMLElement): void => {
  render(<ReplayPanelView />, root);
};

export const unmountReplayPanelView = (root: HTMLElement): void => {
  render(null, root);
};
