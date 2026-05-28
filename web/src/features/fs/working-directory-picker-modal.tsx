import * as Dialog from '@radix-ui/react-dialog';
import { ChevronUp, FolderInput, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useId, useReducer } from 'react';

import { uiPatchReducer } from '@/lib/settings-form-draft';

import { Button } from '@/components/ui/button';
import { getHostFsMeta, listHostFs, type HostFsEntry, type HostFsListPayload } from '@/features/fs/host-fs-api';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { interaction } from '@/lib/interaction';
import type { MessageBundle } from '@/i18n/messages';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 font-mono text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

/** Windows drive root like `C:\` — parent is null but "Up" goes to drive list. */
function isWindowsDriveRootPath(p: string): boolean {
  return /^[A-Za-z]:\\?$/.test(p.replace(/\\$/, '\\'));
}

function canGoUp(state: HostFsListPayload | null): boolean {
  if (!state || state.currentPath === '') return false;
  if (state.parentPath !== null) return true;
  if (state.currentPath === '/') return false;
  if (isWindowsDriveRootPath(state.currentPath)) return true;
  return false;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, open this directory on first load (falls back to root on error). */
  initialAbsolutePath?: string;
  onConfirm: (absolutePath: string) => void | Promise<void>;
  wd: MessageBundle['chat']['workingDirectory'];
};

type PickerUi = {
  metaHostname: string | null;
  listState: HostFsListPayload | null;
  listLoading: boolean;
  listError: string | null;
  manualPath: string;
};

const initialPickerUi: PickerUi = {
  metaHostname: null,
  listState: null,
  listLoading: false,
  listError: null,
  manualPath: '',
};

export function WorkingDirectoryPickerModal({
  open,
  onOpenChange,
  initialAbsolutePath,
  onConfirm,
  wd,
}: Props) {
  const manualId = useId();
  const [ui, dispatch] = useReducer(uiPatchReducer<PickerUi>, initialPickerUi);
  const { metaHostname, listState, listLoading, listError, manualPath } = ui;

  const refreshFromPath = useCallback(async (pathArg?: string) => {
    dispatch({ type: 'patch', patch: { listLoading: true, listError: null } });
    try {
      const payload = await listHostFs(pathArg);
      dispatch({ type: 'patch', patch: { listState: payload } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dispatch({ type: 'patch', patch: { listError: msg, listState: null } });
    } finally {
      dispatch({ type: 'patch', patch: { listLoading: false } });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const m = await getHostFsMeta();
        if (!cancelled) dispatch({ type: 'patch', patch: { metaHostname: m.hostname } });
      } catch {
        if (!cancelled) dispatch({ type: 'patch', patch: { metaHostname: null } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const initial = initialAbsolutePath?.trim() ?? '';
    dispatch({ type: 'patch', patch: { manualPath: initial } });
    let cancelled = false;
    void (async () => {
      dispatch({ type: 'patch', patch: { listLoading: true, listError: null } });
      try {
        if (initial) {
          try {
            const payload = await listHostFs(initial);
            if (!cancelled) dispatch({ type: 'patch', patch: { listState: payload } });
          } catch {
            const payload = await listHostFs();
            if (!cancelled) dispatch({ type: 'patch', patch: { listState: payload } });
          }
        } else {
          const payload = await listHostFs();
          if (!cancelled) dispatch({ type: 'patch', patch: { listState: payload } });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) {
          dispatch({ type: 'patch', patch: { listError: msg, listState: null } });
        }
      } finally {
        if (!cancelled) dispatch({ type: 'patch', patch: { listLoading: false } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, initialAbsolutePath]);

  const enterDir = (entry: HostFsEntry) => {
    if (!entry.isDirectory) return;
    void refreshFromPath(entry.absolutePath);
  };

  const goUp = () => {
    if (!listState) return;
    const { parentPath, currentPath } = listState;
    if (parentPath !== null) {
      void refreshFromPath(parentPath);
      return;
    }
    if (currentPath === '/' || currentPath === '') return;
    if (isWindowsDriveRootPath(currentPath)) {
      void refreshFromPath(undefined);
    }
  };

  const currentDisplayPath =
    listState?.currentPath === '' ? wd.pickerDrives : (listState?.currentPath ?? '');

  const canUseCurrentFolder =
    Boolean(listState) && listState!.currentPath !== '' && !listLoading && !listError;

  const onUseFolder = async () => {
    if (!listState || listState.currentPath === '') return;
    try {
      await onConfirm(listState.currentPath);
      onOpenChange(false);
    } catch {
      /* onConfirm failed; stay open */
    }
  };

  const onApplyManual = async () => {
    const t = manualPath.trim();
    if (!t) return;
    try {
      await onConfirm(t);
      onOpenChange(false);
    } catch {
      /* onConfirm failed; stay open */
    }
  };

  const showLoadingOverlay = listLoading && listState;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[81] flex max-h-[min(90vh,32rem)] w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-edge bg-surface-panel p-4 shadow-popover',
            'dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="text-base font-semibold text-fg">{wd.pathModalTitle}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm leading-relaxed text-fg-muted">
            {wd.pathModalDescription}
          </Dialog.Description>
          {metaHostname ? (
            <p className="mt-2 text-xs text-fg-muted">{wd.pickerHostHint.replace('{{hostname}}', metaHostname)}</p>
          ) : null}

          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="shrink-0 gap-1 px-2 py-1.5 text-xs"
                disabled={listLoading || !canGoUp(listState) || Boolean(listError)}
                onClick={() => goUp()}
                title={wd.pickerUp}
              >
                <ChevronUp className="size-4" aria-hidden />
                {wd.pickerUp}
              </Button>
              <div
                className="min-w-0 flex-1 truncate rounded-md border border-edge-subtle/80 bg-surface-hover/30 px-2 py-1.5 font-mono text-xs text-fg"
                title={currentDisplayPath}
              >
                {listLoading && !listState ? wd.pickerLoading : currentDisplayPath || '—'}
              </div>
            </div>

            <div
              className={cn(
                'relative min-h-[12rem] overflow-y-auto rounded-lg border border-edge-subtle/80 bg-surface-hover/20 p-1 dark:border-edge-subtle',
                interaction.focusRingPanel,
              )}
              role="listbox"
              aria-label={wd.pathModalTitle}
            >
              {showLoadingOverlay ? (
                <div
                  className="absolute inset-0 z-[1] flex items-center justify-center rounded-lg bg-surface-panel/60"
                  aria-hidden
                >
                  <Loader2 className="size-6 animate-spin text-fg-muted" />
                </div>
              ) : null}
              {listLoading && !listState ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-fg-muted">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {wd.pickerLoading}
                </div>
              ) : null}
              {listError ? (
                <p className="px-2 py-8 text-center text-sm text-fg-muted">{wd.pickerListError}</p>
              ) : null}
              {!listLoading && listState && !listError && listState.entries.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-fg-muted">{wd.pickerEmptyFolder}</p>
              ) : null}
              {listState?.entries.map((e) => (
                <button
                  key={e.absolutePath}
                  type="button"
                  role="option"
                  aria-selected={false}
                  disabled={!e.isDirectory}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                    e.isDirectory
                      ? 'cursor-pointer text-fg hover:bg-surface-hover'
                      : 'cursor-default text-fg-muted opacity-60',
                  )}
                  onClick={() => enterDir(e)}
                >
                  <FolderInput className="size-4 shrink-0 text-fg-muted" aria-hidden />
                  <span className="min-w-0 truncate">{e.name}</span>
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <label htmlFor={manualId} className="text-xs text-fg-muted">
                {wd.pickerManualPath}
              </label>
              <input
                id={manualId}
                type="text"
                value={manualPath}
                onChange={(e) => dispatch({ type: 'patch', patch: { manualPath: e.target.value } })}
                placeholder={wd.pathInputPlaceholder}
                className={inputClassName()}
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && manualPath.trim()) {
                    e.preventDefault();
                    void onApplyManual();
                  }
                }}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-edge-subtle/60 pt-3">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {wd.pathModalCancel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!manualPath.trim()}
              onClick={() => void onApplyManual()}
            >
              {wd.pickerApplyManual}
            </Button>
            <Button type="button" disabled={!canUseCurrentFolder} onClick={() => void onUseFolder()}>
              {wd.pickerUseThisFolder}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
