import * as Dialog from '@radix-ui/react-dialog';
import { ClipboardCopy, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LogDetailBody } from '@/features/logs/log-detail-body';
import type { LogEntry } from '@/features/logs/log.types';
import type { LogsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

type Props = {
  L: LogsMessages;
  log: LogEntry | null;
  onClose: () => void;
  copiedDetail: 'json' | 'message' | null;
  onCopiedMessage: () => void;
  onCopiedJson: () => void;
};

export function LogsDetailDrawer({ L, log, onClose, copiedDetail, onCopiedMessage, onCopiedJson }: Props) {
  return (
    <Dialog.Root open={log !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)}
        />
        <Dialog.Content
          className={cn(
            'xopc-drawer-right fixed right-0 top-0 flex h-full w-full max-w-lg flex-col border-l border-edge bg-surface-panel shadow-popover outline-none',
            SETTINGS_SHELL_CONTENT_Z,
            'dark:border-edge',
          )}
          aria-describedby={undefined}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3 dark:border-edge">
            <Dialog.Title className="text-base font-semibold tracking-tight text-fg">{L.details}</Dialog.Title>
            <div className="flex min-w-0 items-center gap-1">
              {log ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 shrink-0 gap-1 px-2 text-xs"
                    onClick={() => {
                      const text = typeof log.message === 'string' ? log.message : '';
                      void navigator.clipboard.writeText(text).then(onCopiedMessage);
                    }}
                  >
                    <ClipboardCopy className="size-3.5 shrink-0" strokeWidth={1.75} />
                    <span className="hidden sm:inline">{copiedDetail === 'message' ? L.copied : L.copyMessage}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 shrink-0 gap-1 px-2 text-xs"
                    onClick={() => {
                      void navigator.clipboard.writeText(JSON.stringify(log, null, 2)).then(onCopiedJson);
                    }}
                  >
                    <ClipboardCopy className="size-3.5 shrink-0" strokeWidth={1.75} />
                    <span className="hidden sm:inline">{copiedDetail === 'json' ? L.copied : L.copyJson}</span>
                  </Button>
                </>
              ) : null}
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="h-9 w-9 shrink-0 p-0" aria-label={L.close}>
                  <X className="size-5" strokeWidth={1.75} />
                </Button>
              </Dialog.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 font-mono text-sm leading-relaxed">
            {log ? (
              <LogDetailBody
                log={log}
                labels={{
                  time: L.time,
                  level: L.level,
                  module: L.module,
                  message: L.message,
                  metadata: L.metadata,
                  requestId: L.requestId,
                  sessionId: L.sessionId,
                }}
              />
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
