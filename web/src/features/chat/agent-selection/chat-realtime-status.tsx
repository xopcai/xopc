import { memo, useEffect, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';

import { reconnectGatewayRealtime } from '@/features/gateway/gateway-realtime';
import { safeErrorDetail } from '@/features/chat/messages/agent-run-error-parser';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useGatewayRealtimeStore } from '@/stores/gateway-realtime-store';

/** Connection feedback belongs to the session; model failures belong to their turn. */
export const ChatRealtimeStatus = memo(function ChatRealtimeStatus() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).chat.runRecovery;
  const connectionState = useGatewayRealtimeStore((s) => s.connectionState);
  const error = useGatewayRealtimeStore((s) => s.error);
  const [visible, setVisible] = useState(false);
  const connecting = connectionState === 'connecting' || connectionState === 'reconnecting';

  useEffect(() => {
    if (!connecting) return;
    const timer = window.setTimeout(() => setVisible(true), 1500);
    return () => { window.clearTimeout(timer); setVisible(false); };
  }, [connecting]);

  if (connectionState !== 'error' && !(connecting && visible)) return null;
  const failed = connectionState === 'error';
  const Icon = failed ? WifiOff : RefreshCw;
  return <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 border-b border-edge-subtle bg-surface-panel px-4 py-2 text-xs text-fg-muted">
    <Icon className={`size-3.5 shrink-0 ${connecting ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
    <span className="min-w-0 flex-1">{failed ? t.connectionFailed : connectionState === 'connecting' ? t.connecting : t.reconnecting}</span>
    {failed ? <>
      <button type="button" className="min-h-9 rounded-md border border-edge px-3 text-xs text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => reconnectGatewayRealtime()}>{t.reconnect}</button>
      {error ? <details className="w-full min-w-0">
        <summary className="w-fit cursor-pointer rounded-md py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{t.details}</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-surface-inset p-2">{safeErrorDetail(error)}</pre>
      </details> : null}
    </> : null}
  </div>;
});
