import type { Message, MessageContent } from '@/features/chat/messages.types';
import { cn } from '@/lib/cn';

function renderBlock(block: MessageContent, key: string) {
  if (block.type === 'text') {
    return (
      <p key={key} className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">
        {block.text}
      </p>
    );
  }
  if (block.type === 'thinking') {
    return (
      <div
        key={key}
        className="rounded-md border border-edge bg-surface-hover px-3 py-2 text-xs text-fg-muted dark:border-edge"
      >
        <span className="font-medium text-fg-subtle">Thinking</span>
        <p className="mt-1 whitespace-pre-wrap">{block.text}</p>
      </div>
    );
  }
  if (block.type === 'tool_use') {
    return (
      <div
        key={key}
        className="rounded-md border border-edge bg-surface-base px-3 py-2 font-mono text-xs dark:border-edge"
      >
        <div className="text-fg-subtle">
          Tool: <span className="text-accent-fg">{block.name}</span>{' '}
          <span className="text-fg-disabled">({block.status})</span>
        </div>
        {block.result ? (
          <pre className="mt-2 max-h-40 overflow-auto text-fg-muted">{block.result}</pre>
        ) : null}
      </div>
    );
  }
  if (block.type === 'image') {
    return (
      <div key={key} className="text-xs text-fg-muted">
        [image]
      </div>
    );
  }
  return null;
}

export function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map((msg, i) => (
        <div
          key={`${msg.timestamp ?? i}-${i}`}
          className={cn(
            'flex flex-col gap-2 rounded-lg border border-transparent px-3 py-2',
            msg.role === 'user' || msg.role === 'user-with-attachments'
              ? 'bg-surface-hover'
              : 'bg-surface-panel',
          )}
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            {msg.role === 'assistant' ? 'Assistant' : 'You'}
          </div>
          <div className="flex flex-col gap-2">
            {msg.content.map((b, j) => renderBlock(b, `${i}-${j}`))}
          </div>
        </div>
      ))}
    </div>
  );
}
