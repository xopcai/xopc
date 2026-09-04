import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Copy, FolderOpen, MonitorUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { useLocaleStore } from '@/stores/locale-store';

type DetectedApp = { name: string; path: string };

type WorkspaceOpenLocationMenuProps = {
  resourceId: string;
  displayName?: string;
  className?: string;
};

/** Opens a managed workspace root without exposing its host path to the renderer. */
export function WorkspaceOpenLocationMenu({
  resourceId,
  displayName,
  className,
}: WorkspaceOpenLocationMenuProps) {
  const language = useLocaleStore((state) => state.language);
  const m = messages(language).workspace;
  const [open, setOpen] = useState(false);
  const [recommendedApps, setRecommendedApps] = useState<DetectedApp[]>([]);
  const [recentApps, setRecentApps] = useState<DetectedApp[]>([]);
  const [busy, setBusy] = useState(false);
  const electron = isElectron();
  const shell = electron ? window.electronAPI?.shell : undefined;
  const available = electron && Boolean(resourceId.trim());
  const compatible = Boolean(shell?.openFileResource);

  const refreshApps = useCallback(async () => {
    if (!shell?.getOpenWithAppsForFileResource || !resourceId.trim()) {
      setRecommendedApps([]);
      setRecentApps([]);
      return;
    }
    try {
      const apps = await shell.getOpenWithAppsForFileResource(resourceId);
      setRecommendedApps(apps.recommended.map((app) => ({ name: app.name, path: app.path })));
      setRecentApps(apps.recent.map((app) => ({ name: app.name, path: app.path })));
    } catch {
      setRecommendedApps([]);
      setRecentApps([]);
    }
  }, [resourceId, shell]);

  useEffect(() => {
    void refreshApps();
  }, [refreshApps]);

  const reportFailure = useCallback(
    (error?: string) => {
      showComposerNotification('warning', error || m.openLocationFailed, undefined, { duration: 4000 });
    },
    [m.openLocationFailed],
  );

  const openInFileManager = useCallback(async () => {
    if (!shell?.openFileResource || !resourceId) return;
    setBusy(true);
    try {
      const result = await shell.openFileResource(resourceId);
      if (result.ok === false) reportFailure(result.error);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }, [reportFailure, resourceId, shell]);

  const openWithApp = useCallback(
    async (appPath: string) => {
      if (!shell?.openFileResourceWithApp || !resourceId) return;
      setBusy(true);
      try {
        const result = await shell.openFileResourceWithApp(resourceId, appPath);
        if (result.ok === false) reportFailure(result.error);
        else void refreshApps();
      } finally {
        setBusy(false);
        setOpen(false);
      }
    },
    [refreshApps, reportFailure, resourceId, shell],
  );

  const chooseApp = useCallback(async () => {
    if (!shell?.chooseAppAndOpenFileResource || !resourceId) return;
    setBusy(true);
    try {
      const result = await shell.chooseAppAndOpenFileResource(resourceId);
      if (result.ok === false && result.code !== 'CANCELED') reportFailure(result.error);
      if (result.ok) void refreshApps();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }, [refreshApps, reportFailure, resourceId, shell]);

  const copyPath = useCallback(async () => {
    if (!shell?.copyFileResourcePath || !resourceId) return;
    const result = await shell.copyFileResourcePath(resourceId);
    showComposerNotification(result.ok ? 'success' : 'warning', result.ok ? m.pathCopied : (result.error || m.copyPathFailed), undefined, {
      duration: result.ok ? 2500 : 4000,
    });
    setOpen(false);
  }, [m.copyPathFailed, m.pathCopied, resourceId, shell]);

  if (!available) return null;

  if (!compatible) {
    return (
      <Button
        variant="ghost"
        className={cn('min-w-0 max-w-40 shrink rounded-md px-2 py-1.5 text-xs', className)}
        disabled
        title={m.desktopUpdateRequired}
      >
        <MonitorUp className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{displayName || m.openLocation}</span>
      </Button>
    );
  }

  const actionClass = 'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-fg hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50';
  const defaultApp = recommendedApps[0] ?? recentApps[0];
  const otherRecommendedApps = defaultApp ? recommendedApps.filter((app) => app.path !== defaultApp.path) : recommendedApps;
  const otherRecentApps = defaultApp ? recentApps.filter((app) => app.path !== defaultApp.path) : recentApps;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refreshApps();
      }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          className={cn(
            'min-w-0 max-w-40 shrink rounded-md px-2 py-1.5 text-xs',
            className,
          )}
          aria-label={m.openLocation}
          title={m.openLocation}
        >
          <MonitorUp className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{defaultApp?.name ?? displayName ?? m.openLocation}</span>
          <ChevronDown className="size-3.5 shrink-0" aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={6}
          className="z-50 w-60 rounded-lg border border-edge bg-surface-panel p-1 shadow-popover outline-none"
        >
          {defaultApp ? (
            <button
              type="button"
              disabled={busy}
              className={actionClass}
              title={defaultApp.path}
              onClick={() => void openWithApp(defaultApp.path)}
            >
              <MonitorUp className="size-4 shrink-0 text-fg-muted" aria-hidden />
              <span className="truncate">{defaultApp.name}</span>
            </button>
          ) : null}
          <div className={cn(defaultApp && 'border-t border-edge pt-1')}>
            <button type="button" disabled={busy} className={actionClass} onClick={() => void openInFileManager()}>
              <FolderOpen className="size-4 shrink-0 text-fg-muted" aria-hidden />
              {m.openInFileManager}
            </button>
          </div>
          {otherRecommendedApps.length > 0 ? (
            <>
              <p className="border-t border-edge px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                {m.recommendedApps}
              </p>
              {otherRecommendedApps.map((app) => (
                <button
                  key={app.path}
                  type="button"
                  disabled={busy}
                  className={actionClass}
                  title={app.path}
                  onClick={() => void openWithApp(app.path)}
                >
                  <MonitorUp className="size-4 shrink-0 text-fg-muted" aria-hidden />
                  <span className="truncate">{app.name}</span>
                </button>
              ))}
            </>
          ) : null}
          {otherRecentApps.length > 0 ? (
            <>
              <p className="border-t border-edge px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                {m.recentApps}
              </p>
              {otherRecentApps.map((app) => (
                <button
                  key={app.path}
                  type="button"
                  disabled={busy}
                  className={actionClass}
                  title={app.path}
                  onClick={() => void openWithApp(app.path)}
                >
                  <MonitorUp className="size-4 shrink-0 text-fg-muted" aria-hidden />
                  <span className="truncate">{app.name}</span>
                </button>
              ))}
            </>
          ) : null}
          <div className="mt-1 border-t border-edge pt-1">
            <button type="button" disabled={busy} className={actionClass} onClick={() => void chooseApp()}>
              <MonitorUp className="size-4 shrink-0 text-fg-muted" aria-hidden />
              {m.chooseApp}
            </button>
            <button type="button" disabled={busy || !shell?.copyFileResourcePath} className={actionClass} onClick={() => void copyPath()}>
              <Copy className="size-4 shrink-0 text-fg-muted" aria-hidden />
              {m.copyPath}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
