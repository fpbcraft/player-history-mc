import { render } from "preact";

export interface ChatNotification {
  id: string;
  head?: string;
  message: string;
  name: string;
  time: string;
}

const ChatNotifications = ({
  notifications,
  onOpen,
}: {
  notifications: readonly ChatNotification[];
  onOpen: () => void;
}) => (
  <>
    {notifications.map((notification) => (
      <button
        type="button"
        class="history-chat-notification"
        key={notification.id}
        onClick={onOpen}
        aria-label={`Open chat: ${notification.name}: ${notification.message}`}
      >
        {notification.head ? (
          <img src={notification.head} alt="" />
        ) : (
          <span aria-hidden="true">●</span>
        )}
        <span>
          <strong>{notification.name}</strong>
          <small>{notification.time}</small>
          <span>{notification.message}</span>
        </span>
      </button>
    ))}
  </>
);

export const renderChatNotifications = (
  root: HTMLElement,
  notifications: readonly ChatNotification[],
  onOpen: () => void,
): void => {
  render(<ChatNotifications notifications={notifications} onOpen={onOpen} />, root);
};
