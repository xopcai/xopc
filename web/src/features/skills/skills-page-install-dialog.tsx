import * as Dialog from '@radix-ui/react-dialog';
import { FileArchive, X } from 'lucide-react';

import type { SkillsPageVm } from '@/features/skills/use-skills-page';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

type Props = Pick<
  SkillsPageVm,
  | 'sk'
  | 'installOpen'
  | 'setInstallOpen'
  | 'pendingFile'
  | 'setPendingFile'
  | 'dropActive'
  | 'setDropActive'
  | 'uploading'
  | 'onModalDragOver'
  | 'onModalDragLeave'
  | 'onModalDrop'
  | 'onFileInputChange'
  | 'onInstallSubmit'
>;

export function SkillsPageInstallDialog(p: Props) {
  const {
    sk,
    installOpen,
    setInstallOpen,
    pendingFile,
    setPendingFile,
    dropActive,
    setDropActive,
    uploading,
    onModalDragOver,
    onModalDragLeave,
    onModalDrop,
    onFileInputChange,
    onInstallSubmit,
  } = p;

  return (
    <Dialog.Root
      open={installOpen}
      onOpenChange={(open) => {
        setInstallOpen(open);
        if (!open) {
          setPendingFile(null);
          setDropActive(false);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 z-[60] max-h-[min(100vh-2rem,44rem)] w-[min(100%-2rem,min(92vw,48rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto',
            'rounded-2xl border border-edge bg-surface-panel p-6 shadow-float dark:border-edge',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-base font-semibold text-fg">{sk.installModalTitle}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn(
                  'rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg',
                  interaction.focusRingPanel,
                )}
                aria-label={sk.installClose}
              >
                <X className="size-5" strokeWidth={1.75} aria-hidden />
                <span className="sr-only">{sk.installClose}</span>
              </button>
            </Dialog.Close>
          </div>

          <label
            className={cn(
              'mt-4 flex min-h-[11rem] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
              dropActive
                ? 'border-accent bg-accent-soft/60 dark:bg-blue-950/40'
                : 'border-edge bg-surface-base dark:bg-surface-hover/30',
            )}
            onDragLeave={onModalDragLeave}
            onDragOver={onModalDragOver}
            onDrop={onModalDrop}
          >
            <input
              type="file"
              accept=".zip,.md,application/zip,text/markdown"
              className="sr-only"
              aria-label={sk.installModalDropHint}
              disabled={uploading}
              onChange={onFileInputChange}
            />
            <FileArchive className="size-12 text-fg-subtle" strokeWidth={1.25} aria-hidden />
            <span className="text-sm text-fg-muted">{sk.installModalDropHint}</span>
            {pendingFile ? <span className="text-xs font-medium text-fg">{pendingFile.name}</span> : null}
          </label>

          <div className="mt-5 space-y-2">
            <p className="text-sm font-medium text-fg">{sk.installModalReqTitle}</p>
            <ul className="list-inside list-disc space-y-1 text-sm text-fg-muted">
              <li>{sk.installModalReq1}</li>
              <li>{sk.installModalReq2}</li>
            </ul>
          </div>

          <button
            type="button"
            disabled={!pendingFile || uploading}
            className={cn(
              'mt-6 flex w-full items-center justify-center rounded-xl py-3 text-sm font-semibold',
              'transition-colors',
              !pendingFile || uploading
                ? 'cursor-not-allowed bg-surface-active text-fg-disabled'
                : 'bg-accent text-white hover:bg-accent-hover',
              interaction.focusRingPanel,
            )}
            onClick={() => void onInstallSubmit()}
          >
            {uploading ? sk.uploading : sk.installAction}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
