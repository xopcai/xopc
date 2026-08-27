import * as Dialog from '@radix-ui/react-dialog';
import { FolderInput, FolderOpen } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { folderDisplayName } from '@/features/fs/directory-path-utils';
import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { useSideChatStore } from '@/stores/side-chat-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';

export function ChatWorkspaceControl({
  sessionKey,
  workspacePath,
  canChangeWorkspace,
  disabled,
  onWorkspaceChange,
}: {
  sessionKey: string;
  workspacePath?: string | null;
  canChangeWorkspace: boolean;
  disabled: boolean;
  onWorkspaceChange: (path: string) => Promise<void>;
}) {
  const language = useLocaleStore((state) => state.language);
  const m = messages(language);
  const openWorkspacePanelForSession = useWorkspacePanelStore((state) => state.openForSession);
  const workspacePanelOpen = useWorkspacePanelStore((state) => state.open);
  const setSideChatOpen = useSideChatStore((state) => state.setOpen);
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
  const pickerDisabled = disabled || directoryPicker.picking;

  const openProjectFiles = () => {
    setSideChatOpen(sessionKey, false);
    openWorkspacePanelForSession(sessionKey);
  };

  return (
    <>
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          className={cn(
            'inline-flex h-8 min-w-0 max-w-44 items-center gap-1.5 rounded-lg px-2 text-fg-muted transition-colors',
            'hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            workspacePanelOpen && 'bg-surface-hover text-fg',
          )}
          title={normalizedPath || workspaceName}
          aria-label={`${m.workspace.openFiles}: ${workspaceName}`}
          aria-pressed={workspacePanelOpen}
          onClick={openProjectFiles}
        >
          <FolderOpen className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="hidden min-w-0 truncate text-xs font-medium sm:inline">{workspaceName}</span>
        </button>
        {canChangeWorkspace ? (
          <button
            type="button"
            disabled={pickerDisabled}
            className={cn(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors',
              'hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              pickerDisabled && 'cursor-not-allowed opacity-50',
            )}
            title={m.chat.workingDirectory.chooseFolder}
            aria-label={m.chat.workingDirectory.chooseFolder}
            onClick={directoryPicker.pick}
          >
            <FolderInput className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
      </div>

      {!directoryPicker.hasNativePicker ? (
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
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[81] w-[min(100%-2rem,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-popover"
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
