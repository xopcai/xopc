import { Loader2, RefreshCw, Wifi, WifiOff } from 'lucide-react';

import { messages } from '@/i18n/messages';
import { reconnectGatewaySse } from '@/features/gateway/sse-controller';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useGatewaySseStore } from '@/stores/gateway-sse-store';
import { useLocaleStore } from '@/stores/locale-store';

export function ConnectionIndicator({
  className,
  compact = false,
}: {
  className?: string;
  /** Icon-first footer when the sidebar is collapsed. */
  compact?: boolean;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language).connection;
  const connectionState = useGatewaySseStore((s) => s.connectionState);
  const error = useGatewaySseStore((s) => s.error);

  const label =
    connectionState === 'connecting' || connectionState === 'idle'
      ? m.connecting
      : connectionState === 'connected'
        ? m.online
        : connectionState === 'reconnecting'
          ? m.reconnecting
          : connectionState === 'error'
            ? error || m.error
            : m.offline;

  return (
    <div
      className={cn(
        'flex min-w-0 gap-1.5 text-xs',
        compact ? 'flex-col items-center px-0.5 py-1' : 'items-center',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="flex shrink-0 items-center justify-center text-fg-subtle" aria-hidden>
        {connectionState === 'connected' ? (
          <Wifi className="size-3.5 text-success" strokeWidth={1.75} />
        ) : connectionState === 'connecting' || connectionState === 'reconnecting' || connectionState === 'idle' ? (
          <Loader2 className="size-3.5 animate-spin text-accent-fg" strokeWidth={1.75} />
        ) : (
          <WifiOff className="size-3.5 text-fg-subtle" strokeWidth={1.75} />
        )}
      </span>
      {compact ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="min-w-0 truncate text-fg-muted" title={label}>
          {label}
        </span>
      )}
      {connectionState !== 'connected' &&
      connectionState !== 'connecting' &&
      connectionState !== 'reconnecting' &&
      connectionState !== 'idle' ? (
        <Button
          type="button"
          variant="ghost"
          className={cn('h-7 shrink-0 px-1.5', compact && 'h-8 w-full px-0')}
          aria-label={m.reconnect}
          title={m.reconnect}
          onClick={() => reconnectGatewaySse()}
        >
          <RefreshCw className="size-3.5 text-fg-subtle" strokeWidth={1.75} />
        </Button>
      ) : null}
    </div>
  );
}
