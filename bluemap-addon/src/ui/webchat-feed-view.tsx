import { render } from "preact";
import type { ChatMessageRecord } from "../types.js";

const WebChatFeed = ({ messages }: { messages: readonly ChatMessageRecord[] }) => (
  <>
    {messages.map((message, index) => (
      <div key={`${message.name}:${message.message}:${index}`}>
        {message.web ? "[Web] " : ""}
        {message.name}: {message.message}
      </div>
    ))}
  </>
);

export const renderWebChatFeed = (
  root: HTMLElement,
  messages: readonly ChatMessageRecord[],
): void => {
  render(<WebChatFeed messages={messages} />, root);
};
