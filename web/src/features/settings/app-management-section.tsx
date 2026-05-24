import { Copy, FolderOpen, Package } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import type { UninstallErrorCode, UninstallInfo } from '@/types/electron';

function formatBytes(bytes: number | null, unknownLabel: string): string {
  if (bytes == null) {
    return unknownLabel;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mapUninstallError(
  code: UninstallErrorCode,
  errors: Record<string, string>,
): string {
  if (code === 'PENDING_UPDATE') {
    return errors.pendingUpdate ?? errors.generic;
  }
  if (code === 'UNINSTALLER_NOT_FOUND') {
    return errors.uninstallerNotFound ?? errors.generic;
  }
  return errors.generic;
}

function resolveUninstallDescription(
  info: UninstallInfo,
  m: AppManagementMessages,
): string {
  if (info.platform === 'darwin') {
    return m.uninstallDescDarwin;
  }
  if (info.platform === 'win32') {
    return m.uninstallDescWin;
  }
  if (info.platform === 'linux') {
    if (info.linuxPackageKind === 'appimage') {
      return m.uninstallDescLinuxAppImage;
    }
    if (info.linuxPackageKind === 'deb') {
      const pkg = info.linuxDebPackageName ?? 'xopc';
      return m.uninstallDescLinuxDeb.replace(/\{\{package\}\}/g, pkg);
    }
    return m.uninstallDescLinuxUnknown;
  }
  return m.uninstallDescLinuxUnknown;
}

type AppManagementMessages = {
  title: string;
  appPath: string;
  dataPath: string;
  dataSize: string;
  dataSizeUnknown: string;
  copyPath: string;
  copied: string;
  copyFailed: string;
  cliDataWarning: string;
  openCliData: string;
  pendingUpdateBlocked: string;
  clearData: string;
  clearDataDesc: string;
  clearDataConfirmTitle: string;
  clearDataConfirmDesc: string;
  clearDataConfirmCheckbox: string;
  clearDataConfirmPhrase: string;
  clearDataConfirmLabel: string;
  clearDataConfirmHint: string;
  uninstall: string;
  uninstallDescDarwin: string;
  uninstallDescWin: string;
  uninstallDescLinuxAppImage: string;
  uninstallDescLinuxDeb: string;
  uninstallDescLinuxUnknown: string;
  uninstallConfirmTitle: string;
  removeUserDataCheckbox: string;
  confirmClear: string;
  confirmUninstall: string;
  cancel: string;
  errors: {
    pendingUpdate: string;
    uninstallerNotFound: string;
    generic: string;
  };
};

type AppManagementSectionProps = {
  api: NonNullable<Window['electronAPI']>['system'];
  messages: AppManagementMessages;
};

export function AppManagementSection({ api, messages: m }: AppManagementSectionProps) {
  const [info, setInfo] = useState<UninstallInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<'app' | 'data' | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearConfirmChecked, setClearConfirmChecked] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [uninstallDialogOpen, setUninstallDialogOpen] = useState(false);
  const [removeUserDataOnUninstall, setRemoveUserDataOnUninstall] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!api?.getUninstallInfo) {
      return;
    }
    setLoadError(null);
    try {
      const next = await api.getUninstallInfo();
      setInfo(next);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyPath = async (value: string, field: 'app' | 'data') => {
    const ok = await copyTextToClipboard(value);
    if (ok) {
      setActionError(null);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 2000);
      return;
    }
    setActionError(m.copyFailed);
  };

  const openCliData = async (path: string) => {
    const shell = window.electronAPI?.shell;
    if (!shell) {
      return;
    }
    const r = await shell.openPath(path);
    if (r.error) {
      setActionError(r.error);
    }
  };

  const handleClearData = async () => {
    if (!api?.clearUserData) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.clearUserData();
      if (!result.ok) {
        setActionError(mapUninstallError(result.error, m.errors));
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : m.errors.generic);
    } finally {
      setBusy(false);
      setClearDialogOpen(false);
      setClearConfirmChecked(false);
      setClearConfirmText('');
    }
  };

  const handleUninstall = async () => {
    if (!api?.uninstallApp) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.uninstallApp({ removeUserData: removeUserDataOnUninstall });
      if (!result.ok) {
        setActionError(mapUninstallError(result.error, m.errors));
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : m.errors.generic);
    } finally {
      setBusy(false);
      setUninstallDialogOpen(false);
    }
  };

  if (loadError) {
    return (
      <p className="text-sm text-amber-600 dark:text-amber-400" role="alert">
        {loadError}
      </p>
    );
  }

  if (!info?.packaged) {
    return null;
  }

  const actionsDisabled = busy || info.pendingUpdate;
  const showUninstall = info.uninstallMode !== 'unsupported';
  const uninstallDescription = resolveUninstallDescription(info, m);
  const clearConfirmReady =
    clearConfirmChecked && clearConfirmText.trim() === m.clearDataConfirmPhrase;

  const openClearDialog = () => {
    setClearConfirmChecked(false);
    setClearConfirmText('');
    setClearDialogOpen(true);
  };

  return (
    <>
      <SettingsFormSection>
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-fg">
          <Package className="size-4 text-accent" strokeWidth={1.75} />
          {m.title}
        </div>

        {actionError ? (
          <p className="mb-3 text-sm text-amber-600 dark:text-amber-400" role="alert">
            {actionError}
          </p>
        ) : null}

        {info.pendingUpdate ? (
          <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            {m.pendingUpdateBlocked}
          </p>
        ) : null}

        {info.hasSeparateCliData && info.cliDataPath ? (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
            <p className="text-xs text-amber-800 dark:text-amber-200">{m.cliDataWarning}</p>
            <button
              type="button"
              className={cn(
                'mt-2 inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-base px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover',
                interaction.press,
              )}
              onClick={() => void openCliData(info.cliDataPath!)}
            >
              <FolderOpen className="size-3.5" strokeWidth={1.75} aria-hidden />
              {m.openCliData}
            </button>
          </div>
        ) : null}

        <dl className="space-y-3 text-sm">
          <div className="rounded-xl border border-edge-subtle bg-surface-panel/60 p-3">
            <dt className="text-xs font-medium text-fg-muted">{m.appPath}</dt>
            <dd className="mt-1 flex items-start justify-between gap-2">
              <code className="break-all text-xs text-fg">{info.appPath}</code>
              <button
                type="button"
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-surface-hover',
                  interaction.press,
                )}
                onClick={() => void copyPath(info.appPath, 'app')}
              >
                <Copy className="size-3" aria-hidden />
                {copiedField === 'app' ? m.copied : m.copyPath}
              </button>
            </dd>
          </div>
          <div className="rounded-xl border border-edge-subtle bg-surface-panel/60 p-3">
            <dt className="text-xs font-medium text-fg-muted">{m.dataPath}</dt>
            <dd className="mt-1 flex items-start justify-between gap-2">
              <code className="break-all text-xs text-fg">{info.userDataPath}</code>
              <button
                type="button"
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-surface-hover',
                  interaction.press,
                )}
                onClick={() => void copyPath(info.userDataPath, 'data')}
              >
                <Copy className="size-3" aria-hidden />
                {copiedField === 'data' ? m.copied : m.copyPath}
              </button>
            </dd>
            <p className="mt-2 text-xs text-fg-muted">
              {m.dataSize}: {formatBytes(info.userDataSizeBytes, m.dataSizeUnknown)}
            </p>
          </div>
        </dl>

        <div className="mt-4 space-y-3">
          <div className="flex flex-col gap-2 rounded-xl border border-edge-subtle bg-surface-panel/60 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-fg">{m.clearData}</div>
              <p className="mt-0.5 text-xs text-fg-muted">{m.clearDataDesc}</p>
            </div>
            <button
              type="button"
              disabled={actionsDisabled}
              className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-lg border border-danger/40 bg-danger px-3 py-1.5 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50',
                interaction.press,
              )}
              onClick={openClearDialog}
            >
              {m.clearData}
            </button>
          </div>

          {showUninstall ? (
            <div className="flex flex-col gap-2 rounded-xl border border-edge-subtle bg-surface-panel/60 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-fg">{m.uninstall}</div>
                <p className="mt-0.5 text-xs text-fg-muted">{uninstallDescription}</p>
              </div>
              <button
                type="button"
                disabled={actionsDisabled}
                className={cn(
                  'inline-flex shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-base px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-hover disabled:opacity-50',
                  interaction.press,
                )}
                onClick={() => {
                  setRemoveUserDataOnUninstall(false);
                  setUninstallDialogOpen(true);
                }}
              >
                {m.uninstall}
              </button>
            </div>
          ) : null}
        </div>
      </SettingsFormSection>

      <Dialog.Root
        open={clearDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setClearDialogOpen(false);
            setClearConfirmChecked(false);
            setClearConfirmText('');
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay
            className={cn(
              'xopc-dialog-overlay fixed inset-0 bg-scrim backdrop-blur-[1px]',
              SETTINGS_SHELL_OVERLAY_Z,
            )}
          />
          <Dialog.Content
            className={cn(
              'fixed left-1/2 top-1/2 w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2',
              SETTINGS_SHELL_CONTENT_Z,
              'rounded-2xl border border-edge bg-surface-panel p-6 shadow-popover outline-none dark:border-edge',
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <Dialog.Title className="text-base font-semibold text-fg">
              {m.clearDataConfirmTitle}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-fg-muted">
              {m.clearDataConfirmDesc}
            </Dialog.Description>
            <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="ui-checkbox mt-0.5"
                checked={clearConfirmChecked}
                onChange={(e) => setClearConfirmChecked(e.target.checked)}
              />
              <span>{m.clearDataConfirmCheckbox}</span>
            </label>
            <div className="mt-4 space-y-2">
              <label className="block text-sm font-medium text-fg" htmlFor="clear-data-confirm">
                {m.clearDataConfirmLabel}
              </label>
              <input
                id="clear-data-confirm"
                type="text"
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  'w-full rounded-md border border-edge bg-surface-panel px-3 py-1.5 font-mono text-xs text-fg',
                  'placeholder:text-fg-subtle',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                  'dark:border-edge',
                )}
                placeholder={m.clearDataConfirmPhrase}
                value={clearConfirmText}
                onChange={(e) => setClearConfirmText(e.target.value)}
              />
              <p className="text-xs text-fg-muted">{m.clearDataConfirmHint}</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setClearDialogOpen(false);
                  setClearConfirmChecked(false);
                  setClearConfirmText('');
                }}
              >
                {m.cancel}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="border-danger/40 bg-danger text-white hover:bg-danger/90 dark:border-danger/40"
                disabled={busy || !clearConfirmReady}
                onClick={() => void handleClearData()}
              >
                {m.confirmClear}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {showUninstall ? (
        <Dialog.Root
          open={uninstallDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              setUninstallDialogOpen(false);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay
              className={cn(
                'xopc-dialog-overlay fixed inset-0 bg-scrim backdrop-blur-[1px]',
                SETTINGS_SHELL_OVERLAY_Z,
              )}
            />
            <Dialog.Content
              className={cn(
                'fixed left-1/2 top-1/2 w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2',
                SETTINGS_SHELL_CONTENT_Z,
                'rounded-2xl border border-edge bg-surface-panel p-6 shadow-popover outline-none dark:border-edge',
              )}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <Dialog.Title className="text-base font-semibold text-fg">
                {m.uninstallConfirmTitle}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-fg-muted">
                {uninstallDescription}
              </Dialog.Description>
              <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="ui-checkbox mt-0.5"
                  checked={removeUserDataOnUninstall}
                  onChange={(e) => setRemoveUserDataOnUninstall(e.target.checked)}
                />
                <span>{m.removeUserDataCheckbox}</span>
              </label>
              {removeUserDataOnUninstall ? (
                <p className="mt-2 text-xs text-fg-muted">{m.clearDataConfirmDesc}</p>
              ) : null}
              <div className="mt-6 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setUninstallDialogOpen(false)}
                >
                  {m.cancel}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="border-danger/40 bg-danger text-white hover:bg-danger/90 dark:border-danger/40"
                  disabled={busy}
                  onClick={() => void handleUninstall()}
                >
                  {m.confirmUninstall}
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </>
  );
}
