import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DirectoryPickerPathField } from '@/features/fs/directory-picker-path-field';
import type { AgentsSettingsMessages, MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

const inputClass = 'w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';

export type ManualAgentDraft = {
  open: boolean;
  name: string;
  instructions: string;
  workspace: string;
};

export function CreateAgentDialog({
  draft,
  busy,
  error,
  messages,
  workingDirectoryMessages,
  onChange,
  onCreate,
  onOpenChange,
}: {
  draft: ManualAgentDraft;
  busy: boolean;
  error: string | null;
  messages: AgentsSettingsMessages;
  workingDirectoryMessages: MessageBundle['chat']['workingDirectory'];
  onChange: (patch: Partial<Omit<ManualAgentDraft, 'open'>>) => void;
  onCreate: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={draft.open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)} />
        <Dialog.Content className={cn(
          'xopc-dialog-content fixed left-1/2 top-1/2 flex h-[min(38rem,calc(100dvh-2rem))] w-[min(92vw,36rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
          'overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover',
          SETTINGS_SHELL_CONTENT_Z,
        )}>
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">{messages.manualCreateTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">
                {messages.manualCreateDescription}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="touch-target shrink-0 rounded-lg p-2 text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={messages.manualCreateClose}>
                <X className="size-4" aria-hidden />
              </button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            {error ? <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}
            <label htmlFor="manual-agent-name" className="block text-xs font-medium text-fg-muted">
              {messages.manualCreateName}
              <input
                id="manual-agent-name"
                autoFocus
                className={`${inputClass} mt-1.5`}
                value={draft.name}
                onChange={(event) => onChange({ name: event.target.value })}
                placeholder={messages.manualCreateNamePlaceholder}
              />
            </label>

            <label htmlFor="manual-agent-instructions" className="block text-xs font-medium text-fg-muted">
              {messages.manualCreateInstructions}
              <textarea
                id="manual-agent-instructions"
                rows={4}
                className={`${inputClass} mt-1.5 resize-y leading-6`}
                value={draft.instructions}
                onChange={(event) => onChange({ instructions: event.target.value })}
                placeholder={messages.manualCreateInstructionsPlaceholder}
              />
            </label>

            <div>
              <label htmlFor="manual-agent-workspace" className="block text-xs font-medium text-fg-muted">
                {messages.manualCreateWorkspace}
              </label>
              <p className="mt-1 text-xs leading-5 text-fg-subtle">{messages.manualCreateWorkspaceHint}</p>
              <div className="mt-2">
                <DirectoryPickerPathField
                  value={draft.workspace}
                  onChange={(workspace) => onChange({ workspace })}
                  disabled={busy}
                  wd={workingDirectoryMessages}
                  placeholder={messages.manualCreateWorkspacePlaceholder}
                  inputAriaLabel={messages.manualCreateWorkspace}
                  inputClassName={`${inputClass} font-mono`}
                />
              </div>
            </div>
          </div>

          <footer className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
            <Dialog.Close asChild><Button disabled={busy}>{messages.manualCreateCancel}</Button></Dialog.Close>
            <Button variant="primary" disabled={busy || !draft.name.trim()} aria-busy={busy} onClick={onCreate}>
              {busy ? messages.manualCreating : messages.manualCreateSubmit}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
