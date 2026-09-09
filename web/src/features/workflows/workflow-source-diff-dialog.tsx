import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import type { StoredLanguage } from '@/lib/storage';

import { buildWorkflowSourceDiff } from './workflow-source';

export function WorkflowSourceDiffDialog({
  comparison,
  language,
  onClose,
}: {
  comparison: { before: string; after: string; beforeLabel: string; afterLabel: string } | null;
  language: StoredLanguage;
  onClose: () => void;
}) {
  const lines = useMemo(
    () => comparison ? buildWorkflowSourceDiff(comparison.before, comparison.after) : [],
    [comparison],
  );
  const changeCount = lines.filter((line) => line.kind !== 'same').length;

  return (
    <Dialog.Root open={Boolean(comparison)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-50 bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-50 flex h-[min(46rem,calc(100vh-2rem))] w-[min(64rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-float">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">{language === 'zh' ? '源码变更' : 'Source changes'}</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-fg-muted">
                {comparison ? `${comparison.beforeLabel} → ${comparison.afterLabel} · ${language === 'zh' ? `${changeCount} 行变更` : `${changeCount} changed lines`}` : ''}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild><Button type="button" variant="ghost" className="size-8 p-0" aria-label={language === 'zh' ? '关闭' : 'Close'}><X className="size-4" /></Button></Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-auto bg-surface-base py-3 font-mono text-xs leading-5">
            {lines.map((line, index) => (
              <div
                key={`${index}:${line.kind}`}
                className={line.kind === 'added' ? 'grid min-w-max grid-cols-[3rem_3rem_1.5rem_minmax(40rem,1fr)] bg-success/10 text-success' : line.kind === 'removed' ? 'grid min-w-max grid-cols-[3rem_3rem_1.5rem_minmax(40rem,1fr)] bg-danger/10 text-danger' : 'grid min-w-max grid-cols-[3rem_3rem_1.5rem_minmax(40rem,1fr)] text-fg-muted'}
              >
                <span className="select-none border-r border-edge-subtle pr-2 text-right text-fg-subtle">{line.beforeLine ?? ''}</span>
                <span className="select-none border-r border-edge-subtle pr-2 text-right text-fg-subtle">{line.afterLine ?? ''}</span>
                <span className="select-none text-center">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span>
                <span className="whitespace-pre pr-5">{line.text || ' '}</span>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
