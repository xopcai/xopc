import * as Dialog from '@radix-ui/react-dialog';
import {
  Content as TooltipContent,
  Portal as TooltipPortal,
  Provider as TooltipProvider,
  Root as TooltipRoot,
  Trigger as TooltipTrigger,
} from '@radix-ui/react-tooltip';
import { FolderInput } from 'lucide-react';
import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { SessionManager } from '@/features/chat/session/session-manager';
import { folderDisplayName } from '@/features/fs/directory-path-utils';
import { DirectoryPickerTrigger } from '@/features/fs/directory-picker-trigger';
import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { showToast } from '@/lib/toast';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';

type Props = {
  sessionKey: string | null;
  disabled: boolean;
  /** Only while the conversation has no messages yet (new chat start). */
  canSelectWorkingDirectory: boolean;
  sessionMgr: SessionManager;
};

export const SessionWorkingDirectoryControl = memo(function SessionWorkingDirectoryControl({
  sessionKey,
  disabled,
  canSelectWorkingDirectory,
  sessionMgr,
}: Props) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const wd = m.chat.workingDirectory;
  const toggleWorkspacePanel = useWorkspacePanelStore((s) => s.toggleOpen);

  const [effectivePath, setEffectivePath] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [errorModalMessage, setErrorModalMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionKey) {
      setEffectivePath('');
      return;
    }
    setLoading(true);
    try {
      const cfg = await sessionMgr.loadSessionAgentConfig(sessionKey);
      setEffectivePath(cfg.effectiveWorkspacePath);
    } catch {
      setEffectivePath('');
    } finally {
      setLoading(false);
    }
  }, [sessionKey, sessionMgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyPath = useCallback(
    async (path: string) => {
      if (!sessionKey?.trim() || !path.trim()) return;
      try {
        await sessionMgr.patchSessionAgentConfig(sessionKey, { workingDirectory: path.trim() });
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErrorModalMessage(msg);
        setErrorModalOpen(true);
        throw e;
      }
    },
    [sessionKey, sessionMgr, refresh],
  );

  const directoryPicker = useDirectoryPicker({ initialPath: effectivePath, onPicked: applyPath });

  const showWorkspaceLockedReminder = useCallback(() => {
    showToast({
      type: 'info',
      title: wd.lockedTapTitle,
      message: wd.lockedTapBody,
      duration: 6500,
    });
  }, [wd.lockedTapBody, wd.lockedTapTitle]);

  if (!sessionKey) {
    return null;
  }

  const fullPath = effectivePath.trim();
  const hasPath = Boolean(fullPath);
  const label = hasPath ? folderDisplayName(fullPath) : wd.notSet;

  const chipClass = cn(
    'inline-flex min-h-8 max-w-[min(12rem,40vw)] min-w-0 shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs',
    'border border-edge-subtle/80 bg-surface-hover/40 dark:border-edge-subtle',
    interaction.transition,
    interaction.focusRingPanel,
  );

  const tooltipContentClass =
    '!z-[10000] max-w-[min(22rem,90vw)] rounded-md border border-edge bg-surface-panel px-2.5 py-2 text-left text-xs leading-snug text-fg shadow-lg';

  const workspaceDirectoryTooltipBody = (opts: {
    hasPath: boolean;
    fullPath: string;
    canSelect: boolean;
  }): ReactNode => {
    const { hasPath: tipHasPath, fullPath: tipPath, canSelect } = opts;
    let footer: string;
    if (!canSelect && tipHasPath) {
      footer = wd.tooltipOpenProjectFiles;
    } else if (canSelect) {
      footer = tipHasPath ? wd.chooseFolder : wd.selectWorkingDirectory;
    } else {
      footer = wd.selectionOnlyAtNewChat;
    }
    return (
      <div className="max-w-[min(22rem,90vw)] space-y-1.5">
        <p className="font-semibold text-fg">{wd.tooltipAgentWorkspace}</p>
        {tipHasPath ? (
          <p className="break-words font-mono text-[11px] leading-snug text-fg-muted">{tipPath}</p>
        ) : (
          <p className="text-[11px] text-fg-muted">{wd.notSet}</p>
        )}
        <p className="text-[11px] leading-snug text-fg-subtle">{footer}</p>
      </div>
    );
  };

  const wrapChipTooltip = (body: ReactNode, chip: React.ReactElement) => (
    <TooltipRoot delayDuration={350}>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipPortal>
        <TooltipContent side="top" sideOffset={6} collisionPadding={12} className={tooltipContentClass}>
          {body}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  );

  const readOnlyChip = () =>
    wrapChipTooltip(
      workspaceDirectoryTooltipBody({ hasPath: false, fullPath: '', canSelect: false }),
      (
        <button
          type="button"
          className={cn(
            chipClass,
            'cursor-pointer text-left text-fg-muted hover:bg-surface-hover/70 dark:hover:bg-surface-hover/50',
          )}
          aria-label={`${wd.notSet}. ${wd.selectionOnlyAtNewChat}`}
          onClick={(e) => {
            e.stopPropagation();
            showWorkspaceLockedReminder();
          }}
        >
          <FolderInput className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
          <span className="min-w-0 truncate text-left font-medium text-fg">{label}</span>
        </button>
      ),
    );

  const openWorkspacePanelChip = () =>
    wrapChipTooltip(
      workspaceDirectoryTooltipBody({ hasPath: true, fullPath, canSelect: false }),
      (
        <button
          type="button"
          disabled={disabled || loading || !hasPath}
          className={cn(
            chipClass,
            hasPath && 'cursor-pointer hover:bg-surface-hover/70 dark:hover:bg-surface-hover/50',
            (disabled || loading || !hasPath) && 'cursor-not-allowed opacity-60',
          )}
          aria-label={`${wd.tooltipAgentWorkspace}: ${fullPath}`}
          onClick={(e) => {
            e.stopPropagation();
            if (hasPath && !disabled && !loading) toggleWorkspacePanel();
          }}
        >
          <FolderInput className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
          <span className="min-w-0 truncate text-left font-medium text-fg">{label}</span>
        </button>
      ),
    );

  if (!canSelectWorkingDirectory) {
    if (!hasPath) {
      return (
        <TooltipProvider delayDuration={350}>
          <div className="inline-flex items-center">{readOnlyChip()}</div>
        </TooltipProvider>
      );
    }
    return (
      <TooltipProvider delayDuration={350}>
        <div className="inline-flex items-center">{openWorkspacePanelChip()}</div>
      </TooltipProvider>
    );
  }

  const ariaSelectable =
    hasPath && !disabled && !loading
      ? `${wd.tooltipAgentWorkspace}: ${fullPath}. ${wd.chooseFolder}`
      : hasPath
        ? `${wd.tooltipAgentWorkspace}: ${fullPath}`
        : wd.selectWorkingDirectory;

  return (
    <TooltipProvider delayDuration={350}>
      <>
        <div className="inline-flex items-center">
          {wrapChipTooltip(
            workspaceDirectoryTooltipBody({ hasPath, fullPath, canSelect: true }),
            (
              <DirectoryPickerTrigger
                value={fullPath}
                onPick={directoryPicker.pick}
                disabled={disabled || loading || directoryPicker.picking}
                placeholder={wd.notSet}
                aria-label={ariaSelectable}
                className={cn(
                  (disabled || loading || directoryPicker.picking) && 'cursor-not-allowed opacity-60',
                )}
              />
            ),
          )}
        </div>

        {!directoryPicker.hasNativePicker ? (
          <WorkingDirectoryPickerModal
            open={directoryPicker.modalOpen}
            onOpenChange={directoryPicker.setModalOpen}
            initialAbsolutePath={fullPath || undefined}
            onConfirm={directoryPicker.confirmPick}
            wd={wd}
          />
        ) : null}

        <Dialog.Root
          open={errorModalOpen}
          onOpenChange={(open) => {
            setErrorModalOpen(open);
            if (!open) setErrorModalMessage(null);
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
            <Dialog.Content
              className={cn(
                'fixed left-1/2 top-1/2 z-[81] w-[min(100%-2rem,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-popover',
                'dark:border-edge',
              )}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <Dialog.Title className="text-base font-semibold text-fg">{wd.applyErrorTitle}</Dialog.Title>
              {errorModalMessage ? (
                <Dialog.Description className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                  {errorModalMessage}
                </Dialog.Description>
              ) : null}
              <div className="mt-4 flex items-center justify-end border-t border-edge-subtle/60 pt-3">
                <Button type="button" onClick={() => setErrorModalOpen(false)}>
                  {wd.applyErrorClose}
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </>
    </TooltipProvider>
  );
});
