import * as Dialog from '@radix-ui/react-dialog';
import { Database, Trash2, Unplug, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import type { PersonalContextSource } from './user-context-api';

export function SourceDisconnectDialog({
  source,
  language,
  busy,
  onOpenChange,
  onConfirm,
}: {
  source: PersonalContextSource | null;
  language: 'en' | 'zh';
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (understandingPolicy: 'keep' | 'delete') => void;
}) {
  const t = messages(language).you;
  const [understandingPolicy, setUnderstandingPolicy] = useState<'keep' | 'delete'>('keep');
  const accountLabel = source?.accountLabel ?? (
    source?.accountCount && source.accountCount > 1 && source.accountOrdinal
      ? t.sourceAccountFallback
        .replace('{{index}}', String(source.accountOrdinal))
        .replace('{{count}}', String(source.accountCount))
      : undefined
  );

  useEffect(() => {
    if (source) setUnderstandingPolicy('keep');
  }, [source]);

  return (
    <Dialog.Root open={source !== null} onOpenChange={(open) => !busy && onOpenChange(open)}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[130] bg-scrim" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] flex h-[min(31rem,calc(100dvh-2rem))] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-elevated">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge-subtle px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">{t.disconnectTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">
                {t.disconnectBody.replace('{{source}}', source?.displayName ?? '')}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={t.cancel} disabled={busy}>
                <X className="size-4" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
            <div className="rounded-xl bg-surface-muted px-4 py-3 text-xs leading-5 text-fg-muted">
              {accountLabel ? <p className="font-medium text-fg">{t.disconnectAccount.replace('{{account}}', accountLabel)}</p> : null}
              <p>{t.disconnectImpact.replace('{{items}}', String(source?.knowledgeItemCount ?? 0)).replace('{{understandings}}', String(source?.derivedUnderstandingCount ?? 0))}</p>
            </div>
            <button
              type="button"
              aria-pressed={understandingPolicy === 'keep'}
              onClick={() => setUnderstandingPolicy('keep')}
              className={cn('flex w-full items-start gap-3 rounded-xl border p-4 text-left', understandingPolicy === 'keep' ? 'border-accent/40 bg-accent-soft/35' : 'border-edge-subtle hover:bg-surface-hover')}
            >
              <Database className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <span><span className="block text-sm font-semibold text-fg">{t.disconnectKeepTitle}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{t.disconnectKeepBody}</span></span>
            </button>
            <button
              type="button"
              aria-pressed={understandingPolicy === 'delete'}
              onClick={() => setUnderstandingPolicy('delete')}
              disabled={!source?.derivedUnderstandingCount}
              className={cn('flex w-full items-start gap-3 rounded-xl border p-4 text-left disabled:cursor-not-allowed disabled:opacity-55', understandingPolicy === 'delete' ? 'border-danger/40 bg-danger-soft' : 'border-edge-subtle hover:bg-surface-hover')}
            >
              <Trash2 className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <span><span className="block text-sm font-semibold text-fg">{t.disconnectDeleteTitle}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{t.disconnectDeleteBody.replace('{{count}}', String(source?.derivedUnderstandingCount ?? 0))}</span></span>
            </button>
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle px-5 py-4">
            <Dialog.Close asChild><Button type="button" variant="ghost" disabled={busy}>{t.cancel}</Button></Dialog.Close>
            <Button type="button" variant="secondary" className={understandingPolicy === 'delete' ? 'border-danger/35 text-danger hover:bg-danger-soft' : undefined} disabled={busy} onClick={() => onConfirm(understandingPolicy)}>
              <Unplug className="size-4" aria-hidden />{busy ? t.disconnecting : t.disconnectAction}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
