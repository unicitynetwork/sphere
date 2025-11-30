import type { IMessage } from '../../../types';
import { MessageBubble } from './MessageBubble';

interface MessageListProps {
  messages: IMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div className="overflow-y-auto p-4 lg:p-8 space-y-6 min-h-0">
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