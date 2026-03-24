import { MessageBubble } from '@/features/chat/message-bubble';
import type { Message, ProgressState } from '@/features/chat/messages.types';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function MessageList({
  messages: list,
  authToken,
  streaming,
  progress,
}: {
  messages: Message[];
  authToken?: string;
  streaming: boolean;
  progress: ProgressState | null;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const showWelcome = list.length === 0 && !streaming;

  return (
    <div className="flex flex-col gap-4 pb-4">
      {showWelcome ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="text-4xl" aria-hidden>
            🤖
          </div>
          <div className="text-lg font-semibold text-fg">{m.chat.welcomeTitle}</div>
          <div className="max-w-sm text-sm text-fg-muted">{m.chat.welcomeDescription}</div>
        </div>
      ) : (
        list.map((msg, index) => {
          const isLast = index === list.length - 1;
          const isStreamRow = Boolean(streaming && isLast && msg.role === 'assistant');
          return (
            <MessageBubble
              key={`${msg.timestamp ?? index}-${index}`}
              message={msg}
              authToken={authToken}
              isStreaming={isStreamRow}
              progress={isStreamRow ? progress : null}
            />
          );
        })
      )}
    </div>
  );
}
