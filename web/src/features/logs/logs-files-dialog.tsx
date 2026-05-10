import * as Dialog from '@radix-ui/react-dialog';
import { Folder, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { LogFile } from '@/features/logs/log.types';
import { formatFileSize, formatTimestampFull } from '@/features/logs/logs-page-lib';
import type { LogsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

type Props = {
  L: LogsMessages;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: LogFile[];
  logDir: string | null;
};

export function LogsFilesDialog({ L, open, onOpenChange, files, logDir }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)}
        />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 flex max-h-[min(32rem,85vh)] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-edge bg-surface-panel shadow-popover outline-none',
            SETTINGS_SHELL_CONTENT_Z,
            'dark:border-edge',
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3 dark:border-edge">
            <Dialog.Title className="flex items-center gap-2 text-base font-semibold tracking-tight text-fg">
              <Folder className="size-4 text-fg-muted" strokeWidth={1.75} />
              {L.logFiles}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" className="h-9 w-9 shrink-0 p-0" aria-label={L.close}>
                <X className="size-5" strokeWidth={1.75} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {files.length === 0 ? (
              <p className="text-sm text-fg-muted">{L.filesEmpty}</p>
            ) : (
              <ul className="flex flex-col gap-2" role="list">
                {files.map((f) => (
                  <li
                    key={f.name}
                    className="flex flex-col gap-1 rounded-lg border border-edge-subtle bg-surface-base px-3 py-2 dark:border-edge"
                  >
                    <span className="break-all font-mono text-xs text-fg">{f.name}</span>
                    <span className="flex flex-wrap gap-x-2 text-xs text-fg-subtle">
                      <span>{formatFileSize(f.size)}</span>
                      <span>{formatTimestampFull(f.modified)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {logDir ? (
            <div className="shrink-0 border-t border-edge-subtle px-4 py-2 text-xs text-fg-subtle dark:border-edge">
              <span className="font-medium text-fg-muted">{L.logDir}: </span>
              <code className="break-all text-fg-subtle">{logDir}</code>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
