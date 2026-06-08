import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { CronTemplateFilter } from '@/features/cron/cron-template-library';
import { CronTemplateLibrary } from '@/features/cron/cron-template-library';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

type CronCopy = MessageBundle['cron'];

export type CronTemplatePickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  c: CronCopy;
  localeTag: string;
  scheduleBadgeLabels: CronCopy['scheduleBadge'];
  categoryFilter: CronTemplateFilter;
  onCategoryFilterChange: (v: CronTemplateFilter) => void;
  onSelectTemplate: (templateId: string) => void;
};

export function CronTemplatePickerDialog({
  open,
  onOpenChange,
  c,
  localeTag,
  scheduleBadgeLabels,
  categoryFilter,
  onCategoryFilterChange,
  onSelectTemplate,
}: CronTemplatePickerDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[62] bg-scrim" />
        <div className="fixed inset-0 z-[62] flex items-center justify-center p-4 pointer-events-none">
          <Dialog.Content
            className={cn(
              'xopc-dialog-content-pane pointer-events-auto relative flex h-[min(90vh,840px)] w-full max-w-5xl flex-col',
              'rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none dark:border-edge',
              interaction.focusRingPanel,
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-edge-subtle px-6 py-5">
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-semibold text-fg">{c.fromTemplate}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">
                  {c.templatePickerHint}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={c.close}>
                  <X className="size-5" strokeWidth={1.75} aria-hidden />
                </Button>
              </Dialog.Close>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-6 py-5">
              <CronTemplateLibrary
                variant="dialog"
                cron={c}
                localeTag={localeTag}
                scheduleBadgeLabels={scheduleBadgeLabels}
                categoryFilter={categoryFilter}
                onCategoryFilterChange={onCategoryFilterChange}
                onSelectTemplate={onSelectTemplate}
              />
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
