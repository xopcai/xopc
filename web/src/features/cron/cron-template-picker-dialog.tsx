import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { CronTemplateFilter } from '@/features/cron/cron-template-library';
import { CronTemplateLibrary } from '@/features/cron/cron-template-library';
import type { MessageBundle } from '@/i18n/messages';

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
            className="xopc-dialog-content-pane pointer-events-auto relative flex max-h-[min(90vh,840px)] w-full max-w-lg flex-col rounded-xl border border-edge bg-surface-panel shadow-popover outline-none sm:max-w-2xl dark:border-edge"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex shrink-0 items-center justify-end border-b border-edge px-4 py-3">
              <Dialog.Title className="sr-only">{c.fromTemplate}</Dialog.Title>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={c.close}>
                  <X className="size-5" strokeWidth={1.75} />
                </Button>
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <CronTemplateLibrary
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
