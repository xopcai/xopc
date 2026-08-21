import { memo } from 'react';

import { reconnectGatewayRealtime } from '@/features/gateway/gateway-realtime';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useGatewayRealtimeStore } from '@/stores/gateway-realtime-store';

/** Isolated from chat body — only re-renders when realtime state or locale changes. */
export const ChatRealtimeStatus = memo(function ChatRealtimeStatus() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const connectionState = useGatewayRealtimeStore((s) => s.connectionState);
  const error = useGatewayRealtimeStore((s) => s.error);

  if (connectionState === 'idle') {
    return null;
  }

  if (connectionState === 'error' && error) {
    return (
      <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-950/50 dark:text-red-400">
        <span className="min-w-0 flex-1 truncate">{error}</span>
        <button
          type="button"
          className={cn(
            'shrink-0 rounded-xl border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700',
            'hover:bg-red-50 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70',
            interaction.transition,
            interaction.press,
            interaction.focusRingPanel,
          )}
          onClick={() => reconnectGatewayRealtime()}
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
          className="inline-block size-3 animate-spin rounded-full border-2 border-amber-500 border-t-transparent"
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
