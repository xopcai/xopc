import * as Dialog from '@radix-ui/react-dialog';
import { FolderInput, SquarePlus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { folderDisplayName } from '@/features/fs/directory-path-utils';
import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';

export function ChatWorkspaceControl({
  conversationId,
  directoryOnly = false,
  workspacePath,
  canChangeWorkspace,
  disabled,
  available = true,
  onWorkspaceChange,
}: {
  conversationId: string | null;
  directoryOnly?: boolean;
  workspacePath?: string | null;
  canChangeWorkspace: boolean;
  disabled: boolean;
  available?: boolean;
  onWorkspaceChange: (path: string) => Promise<void>;
}) {
  const language = useLocaleStore((state) => state.language);
  const m = messages(language);
  const openWorkspacePanelForSession = useWorkspacePanelStore((state) => state.openForSession);
  const workspacePanelOpen = useRightWorkspaceStore((state) => state.panes[conversationId ?? 'new']?.open === true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const normalizedPath = workspacePath?.trim() ?? '';
  const workspaceName = normalizedPath ? folderDisplayName(normalizedPath) : m.chat.workingDirectory.notSet;

  const applyWorkspace = async (path: string) => {
    try {
      await onWorkspaceChange(path);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const directoryPicker = useDirectoryPicker({
    initialPath: normalizedPath,
    onPicked: applyWorkspace,
  });
  const pickerDisabled = disabled || !available || directoryPicker.picking;

  const toggleWorkspace = () => {
    const workspace = useRightWorkspaceStore.getState();
    const scope = conversationId ?? 'new';
    workspace.setScope(scope);
    const home = workspace.panes[scope]?.tabs.find((tab) => tab.kind === 'home');
    if (home) workspace.activate(home.id, scope);
    else workspace.openTools(scope);
    openWorkspacePanelForSession(conversationId ?? '');
  };

  return (
    <>
      <div className="flex min-w-0 items-center gap-0.5">
        {!directoryOnly ? <button
          type="button"
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors',
            'hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            workspacePanelOpen && 'bg-surface-hover text-fg',
          )}
          title={language === 'zh' ? '打开工具' : 'Open workspace tools'}
          aria-label={language === 'zh' ? '打开工具' : 'Open workspace tools'}
          aria-pressed={workspacePanelOpen}
          aria-controls="app-workspace-panel"
          data-workspace-trigger
          onClick={toggleWorkspace}
        >
          <SquarePlus className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        </button> : null}
        {directoryOnly && canChangeWorkspace ? (
          <button
            type="button"
            disabled={pickerDisabled}
            className={cn(
              'inline-flex h-8 max-w-full shrink-0 px-2 items-center justify-center rounded-lg text-fg-muted transition-colors',
              'hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              pickerDisabled && 'cursor-not-allowed opacity-50',
            )}
            title={`${m.chat.workingDirectory.chooseFolder}: ${normalizedPath || workspaceName}`}
            aria-label={m.chat.workingDirectory.chooseFolder}
            onClick={directoryPicker.pick}
          >
            <FolderInput className="mr-2 size-4" strokeWidth={1.75} aria-hidden />
            <span className="truncate text-xs">{m.chat.workingDirectory.chooseFolder}</span>
          </button>
        ) : null}
      </div>

      {directoryOnly && !directoryPicker.hasNativePicker ? (
        <WorkingDirectoryPickerModal
          open={directoryPicker.modalOpen}
          onOpenChange={directoryPicker.setModalOpen}
          initialAbsolutePath={normalizedPath || undefined}
          onConfirm={directoryPicker.confirmPick}
          wd={m.chat.workingDirectory}
        />
      ) : null}

      <Dialog.Root open={errorMessage !== null} onOpenChange={(open) => { if (!open) setErrorMessage(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content
            className="xopc-dialog-content fixed left-1/2 top-1/2 z-[81] w-[min(100%-2rem,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-overlay p-4 shadow-popover"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <Dialog.Title className="text-base font-semibold text-fg">
              {m.chat.workingDirectory.applyErrorTitle}
            </Dialog.Title>
            {errorMessage ? (
              <Dialog.Description className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                {errorMessage}
              </Dialog.Description>
            ) : null}
            <div className="mt-4 flex justify-end border-t border-edge-subtle pt-3">
              <Button type="button" onClick={() => setErrorMessage(null)}>
                {m.chat.workingDirectory.applyErrorClose}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
