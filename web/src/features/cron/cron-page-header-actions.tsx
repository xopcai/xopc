import { LayoutTemplate, Plus, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

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
      <Button
        type="button"
        variant="ghost"
        className="h-9 w-9 shrink-0 p-0"
        disabled={busy}
        title={c.refresh}
        aria-label={c.refresh}
        onClick={() => void onRefresh()}
      >
        <RefreshCw className={cn('size-4', busy && 'animate-spin')} strokeWidth={1.75} />
      </Button>
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
