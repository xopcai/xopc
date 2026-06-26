import { memo } from 'react';

import { RefreshButton } from '@/components/ui/refresh-button';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

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
      <RefreshButton className="size-9 shrink-0 p-0" loading={refreshing} label={ch.refresh} onClick={onRefresh} />
    </div>
  );
});
