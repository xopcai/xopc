import { ChatComposer } from '@/features/chat/chat-composer';
import { MessageList } from '@/features/chat/message-list';
import { useChatSession } from '@/features/chat/use-chat-session';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function ChatPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const {
    messages: chatMessages,
    sessionName,
    loading,
    error,
    streaming,
    sending,
    progress,
    sendMessage,
    abort,
    hasToken,
  } = useChatSession();

  if (!hasToken) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-fg-muted">
        {m.chat.needToken}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-fg-muted">
        {m.chat.loading}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        {sessionName ? (
          <h2 className="mb-4 text-sm font-medium text-fg-muted">{sessionName}</h2>
        ) : null}
        {error ? (
          <div className="mb-4 rounded-md border border-edge bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-edge dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}
        <MessageList messages={chatMessages} />
      </div>
      {progress ? (
        <div className="border-t border-edge bg-surface-panel px-4 py-2 text-xs text-fg-subtle dark:border-edge">
          {progress.message}
        </div>
      ) : null}
      <ChatComposer
        disabled={false}
        sending={sending}
        streaming={streaming}
        onSend={sendMessage}
        onAbort={abort}
      />
    </div>
  );
}
