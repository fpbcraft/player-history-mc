import { HistoryIcon } from "./history-icon.js";

export const HistoryChat = () => (
  <>
    <button
      type="button"
      name="webchat"
      class="history-chat-launcher"
      aria-label="Web chat"
      title="Web chat"
      aria-controls="history-chat-panel"
      aria-expanded="false"
    >
      <HistoryIcon name="webchat" />
    </button>
    <aside id="history-chat-panel" class="history-chat-panel" hidden aria-label="Web chat">
      <div class="history-chat-heading">
        <strong>Chat</strong>
        <button type="button" name="chat-close" aria-label="Close chat">
          ×
        </button>
      </div>
      <div class="history-chat-content">
        <div
          class="history-chat"
          role="log"
          aria-live="polite"
          aria-label="Chat history for selected range"
        />
        <div class="history-webchat">
          <div class="history-webchat-feed" aria-live="polite" />
          <button type="button" name="chat-connect">
            Connect Minecraft account
          </button>
          <button type="button" name="chat-logout" hidden>
            Log out
          </button>
          <output name="chat-status" />
          <form class="history-chat-form" hidden>
            <input
              name="chat-message"
              aria-label="Chat message"
              maxLength={256}
              placeholder="Message the server…"
              required
            />
            <button type="submit">Send</button>
          </form>
        </div>
      </div>
    </aside>
  </>
);
