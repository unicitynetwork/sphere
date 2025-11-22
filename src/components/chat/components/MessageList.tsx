import type { IMessage } from '../../../types';
import { MessageBubble } from './MessageBubble';

interface MessageListProps {
  messages: IMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6">
      {messages.map((msg, index) => (
        <MessageBubble
          key={msg.id}
          msg={msg}
          isFirst={index === 0}
          delay={index * 0.05}
        />
      ))}
    </div>
  );
}