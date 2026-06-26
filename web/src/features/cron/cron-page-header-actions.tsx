import { LayoutTemplate, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import type { MessageBundle } from '@/i18n/messages';

type CronCopy = MessageBundle['cron'];

export type CronPageHeaderActionsProps = {
  c: CronCopy;
  loading: boolean;
  runHistoryLoading: boolean;
  onRefresh: () => void;
  onOpenTemplatePicker: () => void;
  onAddJob: () => void;
};

export function CronPageHeaderActions({
  c,
  loading,
  runHistoryLoading,
  onRefresh,
  onOpenTemplatePicker,
  onAddJob,
}: CronPageHeaderActionsProps) {
  const busy = loading || runHistoryLoading;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
      <RefreshButton className="size-9 shrink-0 p-0" loading={busy} label={c.refresh} onClick={onRefresh} />
      <Button type="button" variant="secondary" className="gap-2" onClick={onOpenTemplatePicker}>
        <LayoutTemplate className="size-4" strokeWidth={1.75} />
        {c.fromTemplate}
      </Button>
      <Button type="button" variant="primary" className="gap-2" onClick={onAddJob}>
        <Plus className="size-4" strokeWidth={1.75} />
        {c.addJob}
      </Button>
    </div>
  );
}
