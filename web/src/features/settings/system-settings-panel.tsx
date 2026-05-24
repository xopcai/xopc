import { ExternalLink, RefreshCw, Shield } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AppManagementSection } from '@/features/settings/app-management-section';
import { SettingsFormSection, settingsFormSectionClassName } from '@/features/settings/settings-form-section';
import {
  dispatchShellPrefsChanged,
  enableDesktopNotificationsWithTest,
} from '@/features/electron/desktop-notifications';
import { isElectron } from '@/lib/electron-env';
import type { StoredLanguage } from '@/lib/storage';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { PrivacyPaneKind, PermissionRequestResult, ShellPermissionSnapshot, SystemSettingsBehavior, TccTriState } from '@/types/electron';

async function probeRendererMicrophone(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return true;
  } catch {
    return false;
  }
}

function microphoneFeedback(
  result: PermissionRequestResult,
  rendererOk: boolean,
  fb: {
    granted: string;
    alreadyGranted: string;
    openedSettings: string;
    denied: string;
    rendererDenied: string;
    prompted: string;
  },
): string {
  if (result.outcome === 'opened-settings') {
    return fb.openedSettings;
  }
  if (result.status === 'granted' && rendererOk) {
    return result.outcome === 'already-granted' ? fb.alreadyGranted : fb.granted;
  }
  if (!rendererOk) {
    return fb.rendererDenied;
  }
  if (result.status === 'denied') {
    return fb.denied;
  }
  return fb.prompted;
}

function accessibilityFeedback(
  result: PermissionRequestResult,
  fb: {
    granted: string;
    alreadyGranted: string;
    openedSettings: string;
    denied: string;
  },
): string {
  if (result.outcome === 'opened-settings') {
    return fb.openedSettings;
  }
  if (result.status === 'granted') {
    return result.outcome === 'already-granted' ? fb.alreadyGranted : fb.granted;
  }
  return fb.denied;
}

const PERM_ROWS: { key: keyof ShellPermissionSnapshot; pane: PrivacyPaneKind; platforms?: Array<'darwin' | 'win32'> }[] = [
  { key: 'fullDisk', pane: 'fullDisk', platforms: ['darwin'] },
  { key: 'screen', pane: 'screen' },
  { key: 'microphone', pane: 'microphone' },
  { key: 'accessibility', pane: 'accessibility' },
  { key: 'automation', pane: 'automation' },
  { key: 'notifications', pane: 'notifications' },
  { key: 'location', pane: 'location' },
];

function overlayRendererPermissions(perms: ShellPermissionSnapshot): ShellPermissionSnapshot {
  if (typeof Notification === 'undefined') {
    return perms;
  }
  const p = Notification.permission;
  if (p === 'default') {
    return perms;
  }
  return {
    ...perms,
    notifications: p === 'granted' ? 'granted' : 'denied',
  };
}

function visiblePermRows(platform: SystemSettingsBehavior['platform']) {
  if (platform === 'linux') {
    return PERM_ROWS;
  }
  return PERM_ROWS.filter((row) => !row.platforms || row.platforms.includes(platform));
}

function triStateFromMessages(
  lang: StoredLanguage,
  s: TccTriState,
): { label: string; className: string } {
  const m = messages(lang).systemSettings.status;
  if (s === 'granted') {
    return { label: m.granted, className: 'text-emerald-600 dark:text-emerald-400' };
  }
  if (s === 'denied') {
    return { label: m.denied, className: 'text-amber-600 dark:text-amber-400' };
  }
  return { label: m.unknown, className: 'text-fg-muted' };
}

function permUnknownHint(
  lang: StoredLanguage,
  key: keyof ShellPermissionSnapshot,
  platform: SystemSettingsBehavior['platform'],
): string | null {
  const hints = messages(lang).systemSettings.permUnknown?.[key];
  if (!hints) {
    return null;
  }
  if (platform === 'darwin' && hints.darwin) {
    return hints.darwin;
  }
  if (platform === 'win32' && hints.win32) {
    return hints.win32;
  }
  if (platform === 'linux' && hints.linux) {
    return hints.linux;
  }
  return null;
}

export function SystemSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.systemSettings;

  const [behavior, setBehavior] = useState<SystemSettingsBehavior | null>(null);
  const [perms, setPerms] = useState<ShellPermissionSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [permFeedback, setPermFeedback] = useState<string | null>(null);
  const [permBusy, setPermBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const api = typeof window !== 'undefined' ? window.electronAPI?.system : undefined;

  const load = useCallback(
    async (options?: { showRefreshFeedback?: boolean }) => {
      if (!api) {
        return;
      }
      setLoadError(null);
      try {
        const b = await api.getBehavior();
        setBehavior(b);
        setPerms(overlayRendererPermissions(await api.getPermissions()));
        if (options?.showRefreshFeedback) {
          setPermFeedback(t.refreshDone);
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
        if (options?.showRefreshFeedback) {
          setPermFeedback(null);
        }
      }
    },
    [api, t.refreshDone],
  );

  const handleRefresh = useCallback(async () => {
    if (refreshing || permBusy) {
      return;
    }
    setRefreshing(true);
    try {
      await load({ showRefreshFeedback: true });
    } finally {
      setRefreshing(false);
    }
  }, [load, permBusy, refreshing]);

  useEffect(() => {
    const autoClearMessages = new Set([
      t.refreshDone,
      t.openSettingsDone,
      t.openSettingsFailed,
      t.desktopNotify.testShown,
    ]);
    if (!permFeedback || !autoClearMessages.has(permFeedback)) {
      return;
    }
    const timer = window.setTimeout(() => {
      setPermFeedback((current) => (current === permFeedback ? null : current));
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [permFeedback, t.openSettingsDone, t.openSettingsFailed, t.refreshDone, t.desktopNotify.testShown]);

  useEffect(() => {
    if (isElectron() && api) {
      void load();
    }
  }, [api, load]);

  if (!isElectron() || !api) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
        <div className={settingsFormSectionClassName()}>
          <p className="text-sm font-medium text-fg">{t.desktopOnlyTitle}</p>
          <p className="mt-1 text-sm text-fg-muted">{t.desktopOnlyBody}</p>
        </div>
      </div>
    );
  }

  const patchBehavior = async (patch: {
    openAtLogin?: boolean;
    keepAwakePreferred?: boolean;
    notifyEnabled?: boolean;
    notifySoundEnabled?: boolean;
  }) => {
    try {
      const { behavior: next } = await api.setBehavior(patch);
      setBehavior(next);
      if (patch.notifyEnabled !== undefined || patch.notifySoundEnabled !== undefined) {
        dispatchShellPrefsChanged();
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleNotifyDesktopToggle = async (checked: boolean) => {
    if (!checked) {
      await patchBehavior({ notifyEnabled: false });
      return;
    }
    setPermBusy(true);
    setPermFeedback(null);
    try {
      const result = await enableDesktopNotificationsWithTest(
        t.desktopNotify.testTitle,
        t.desktopNotify.testBody,
      );
      if (result === 'unsupported') {
        setPermFeedback(t.notificationsFeedback.unsupported);
        return;
      }
      if (result === 'denied') {
        setPermFeedback(t.desktopNotify.denied);
        return;
      }
      if (result === 'default') {
        setPermFeedback(t.notificationsFeedback.default);
        return;
      }
      await patchBehavior({ notifyEnabled: true });
      setPerms(overlayRendererPermissions(await api.getPermissions()));
      setPermFeedback(t.desktopNotify.testShown);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setPermBusy(false);
    }
  };

  const openPrivacy = async (kind: PrivacyPaneKind) => {
    setPermFeedback(null);
    setLoadError(null);
    try {
      const r = await api.openPrivacy(kind);
      if (!r.ok) {
        setPermFeedback(t.openSettingsFailed);
      } else {
        setPermFeedback(t.openSettingsDone);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const requestMicrophone = async () => {
    setPermBusy(true);
    setPermFeedback(null);
    setLoadError(null);
    try {
      const result = await api.requestMicrophone();
      const rendererOk = await probeRendererMicrophone();
      setPerms(overlayRendererPermissions(await api.getPermissions()));
      setPermFeedback(microphoneFeedback(result, rendererOk, t.permFeedback));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setPermBusy(false);
    }
  };

  const requestAccessibility = async () => {
    if (!api.requestAccessibility) {
      return;
    }
    setPermBusy(true);
    setPermFeedback(null);
    setLoadError(null);
    try {
      const result = await api.requestAccessibility();
      setPerms(overlayRendererPermissions(await api.getPermissions()));
      setPermFeedback(accessibilityFeedback(result, t.accessibilityFeedback));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setPermBusy(false);
    }
  };

  const requestNotifications = async () => {
    setPermBusy(true);
    setPermFeedback(null);
    setLoadError(null);
    try {
      if (typeof Notification === 'undefined') {
        setPermFeedback(t.notificationsFeedback.unsupported);
        return;
      }
      const result = await Notification.requestPermission();
      setPerms(overlayRendererPermissions(await api.getPermissions()));
      if (result === 'granted') {
        setPermFeedback(t.notificationsFeedback.granted);
      } else if (result === 'denied') {
        setPermFeedback(t.notificationsFeedback.denied);
      } else {
        setPermFeedback(t.notificationsFeedback.default);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setPermBusy(false);
    }
  };

  const permissionsHint = (() => {
    if (!behavior) {
      return t.permissionsHint;
    }
    if (behavior.platform === 'win32') {
      return t.permissionsHintWin;
    }
    if (behavior.platform === 'linux') {
      return t.permissionsHintLinux;
    }
    if (behavior.platform === 'darwin') {
      return t.permissionsHintDarwin;
    }
    return t.permissionsHint;
  })();

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
      </div>

      {loadError ? (
        <p className="text-sm text-amber-600 dark:text-amber-400" role="alert">
          {loadError}
        </p>
      ) : null}

      {permFeedback ? (
        <p
          className={cn(
            'text-sm',
            permFeedback === t.refreshDone
              ? 'text-emerald-600 dark:text-emerald-400'
              : permFeedback === t.openSettingsDone ||
                  permFeedback === t.permFeedback.granted ||
                  permFeedback === t.permFeedback.alreadyGranted ||
                  permFeedback === t.accessibilityFeedback.granted ||
                  permFeedback === t.accessibilityFeedback.alreadyGranted ||
                  permFeedback === t.notificationsFeedback.granted ||
                  permFeedback === t.desktopNotify.testShown
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-fg-muted',
          )}
          role="status"
          aria-live="polite"
        >
          {permFeedback}
        </p>
      ) : null}

      <SettingsFormSection>
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-fg">
          <Shield className="size-4 text-accent" strokeWidth={1.75} />
          {t.behaviorGroup}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-hover/50 px-3 py-2.5 dark:bg-surface-hover/35">
            <div>
              <div className="text-sm font-medium text-fg">{t.toggles.openAtLogin}</div>
              <p className="text-xs text-fg-muted">{t.toggles.openAtLoginDesc}</p>
            </div>
            <input
              type="checkbox"
              className="ui-checkbox"
              disabled={!behavior}
              checked={Boolean(behavior?.openAtLogin)}
              onChange={(e) => {
                void patchBehavior({ openAtLogin: e.target.checked });
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-hover/50 px-3 py-2.5 dark:bg-surface-hover/35">
            <div>
              <div className="text-sm font-medium text-fg">{t.toggles.keepAwake}</div>
              <p className="text-xs text-fg-muted">{t.toggles.keepAwakeDesc}</p>
            </div>
            <input
              type="checkbox"
              className="ui-checkbox"
              disabled={!behavior}
              checked={Boolean(behavior?.keepAwakePreferred)}
              onChange={(e) => {
                void patchBehavior({ keepAwakePreferred: e.target.checked });
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-hover/50 px-3 py-2.5 dark:bg-surface-hover/35">
            <div>
              <div className="text-sm font-medium text-fg">{t.toggles.notifyDesktop}</div>
              <p className="text-xs text-fg-muted">{t.toggles.notifyDesktopDesc}</p>
            </div>
            <input
              type="checkbox"
              className="ui-checkbox"
              disabled={!behavior || permBusy}
              checked={Boolean(behavior?.notifyEnabled)}
              onChange={(e) => {
                void handleNotifyDesktopToggle(e.target.checked);
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-hover/50 px-3 py-2.5 dark:bg-surface-hover/35">
            <div>
              <div className="text-sm font-medium text-fg">{t.toggles.notifySound}</div>
              <p className="text-xs text-fg-muted">{t.toggles.notifySoundDesc}</p>
            </div>
            <input
              type="checkbox"
              className="ui-checkbox"
              disabled={!behavior}
              checked={Boolean(behavior?.notifySoundEnabled)}
              onChange={(e) => {
                void patchBehavior({ notifySoundEnabled: e.target.checked });
              }}
            />
          </div>
        </div>
      </SettingsFormSection>

      {behavior && perms ? (
        <section className={settingsFormSectionClassName()}>
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-fg">{t.permissionsTitle}</h2>
              <p className="mt-0.5 text-xs text-fg-muted">{permissionsHint}</p>
            </div>
            <button
              type="button"
              disabled={refreshing || permBusy}
              aria-busy={refreshing}
              className={cn(
                'mt-2 inline-flex max-w-full items-center justify-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50 sm:mt-0',
                interaction.press,
              )}
              onClick={() => void handleRefresh()}
            >
              <RefreshCw
                className={cn('size-3.5', refreshing && 'animate-spin')}
                strokeWidth={1.75}
                aria-hidden
              />
              {refreshing ? t.refreshing : t.refresh}
            </button>
          </div>
          <ul className="space-y-3">
            {visiblePermRows(behavior.platform).map(({ key, pane }) => {
              const st = triStateFromMessages(language, perms[key]);
              const permLabel = t.perm[key];
              const unknownHint =
                perms[key] === 'unknown' ? permUnknownHint(language, key, behavior.platform) : null;
              if (!permLabel) {
                return null;
              }
              return (
                <li
                  key={key}
                  className="flex flex-col gap-2 rounded-xl border border-edge-subtle bg-surface-panel/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-fg">{permLabel.title}</div>
                    <p className="mt-0.5 text-xs text-fg-muted">{permLabel.desc}</p>
                    <p className={`mt-1 text-xs font-medium ${st.className}`}>{st.label}</p>
                    {unknownHint ? (
                      <p className="mt-1 text-xs text-fg-muted">{unknownHint}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {key === 'notifications' && typeof Notification !== 'undefined' ? (
                      <button
                        type="button"
                        disabled={permBusy}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-lg border border-edge bg-surface-base px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover disabled:opacity-50',
                          interaction.press,
                        )}
                        onClick={() => void requestNotifications()}
                      >
                        {t.requestAccess}
                      </button>
                    ) : null}
                    {key === 'microphone' ? (
                      <button
                        type="button"
                        disabled={permBusy}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-lg border border-edge bg-surface-base px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover disabled:opacity-50',
                          interaction.press,
                        )}
                        onClick={() => void requestMicrophone()}
                      >
                        {t.requestAccess}
                      </button>
                    ) : null}
                    {key === 'accessibility' &&
                    (behavior?.platform === 'darwin' || behavior?.platform === 'win32') ? (
                      <button
                        type="button"
                        disabled={permBusy}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-lg border border-edge bg-surface-base px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover disabled:opacity-50',
                          interaction.press,
                        )}
                        onClick={() => void requestAccessibility()}
                      >
                        {t.requestAccess}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-base px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover',
                        interaction.press,
                      )}
                      onClick={() => void openPrivacy(pane)}
                    >
                      {t.openSettings}
                      <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {api ? <AppManagementSection api={api} messages={t.appManagement} /> : null}
    </div>
  );
}
