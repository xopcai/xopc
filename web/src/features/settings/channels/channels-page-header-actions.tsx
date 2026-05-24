import { RefreshCw } from 'lucide-react';
import { memo } from 'react';

import { Button } from '@/components/ui/button';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

export const ChannelsPageHeaderActions = memo(function ChannelsPageHeaderActions({
  ch,
  refreshing,
  saveOk,
  onRefresh,
}: {
  ch: ChannelsSettingsMessages;
  refreshing: boolean;
  saveOk: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
      {saveOk ? <span className="text-sm text-fg-muted">{ch.saved}</span> : null}
      <Button
        type="button"
        variant="ghost"
        className="size-9 shrink-0 p-0"
        disabled={refreshing}
        title={ch.refresh}
        aria-label={ch.refresh}
        aria-busy={refreshing}
        onClick={() => void onRefresh()}
      >
        <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} strokeWidth={1.75} />
      </Button>
    </div>
  );
});
