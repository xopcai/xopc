import { memo } from 'react';

import { reconnectGatewaySse } from '@/features/gateway/sse-controller';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useGatewaySseStore } from '@/stores/gateway-sse-store';

/** Isolated from chat body — only re-renders when SSE store / locale changes. */
export const ChatSseStatus = memo(function ChatSseStatus() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const connectionState = useGatewaySseStore((s) => s.connectionState);
  const error = useGatewaySseStore((s) => s.error);

  if (connectionState === 'idle') {
    return null;
  }

  if (connectionState === 'error' && error) {
    return (
      <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-950/50 dark:text-red-400">
        <span className="min-w-0 flex-1 truncate">{error}</span>
        <button
          type="button"
          className="shrink-0 rounded-xl border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors duration-150 hover:bg-red-50 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
          onClick={() => reconnectGatewaySse()}
        >
          {m.connection.reconnect}
        </button>
      </div>
    );
  }

  if (connectionState === 'connecting' || connectionState === 'reconnecting') {
    return (
      <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/50 dark:text-amber-200">
        <span
          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-500 border-t-transparent"
          aria-hidden
        />
        <span>
          {connectionState === 'reconnecting' ? m.connection.reconnecting : m.connection.connecting}
        </span>
      </div>
    );
  }

  return null;
});
