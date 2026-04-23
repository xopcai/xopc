import { ExternalLink, Shield } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { SettingsFormSection, settingsFormSectionClassName } from '@/features/settings/settings-form-section';
import { isElectron } from '@/lib/electron-env';
import type { StoredLanguage } from '@/lib/storage';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import type { PrivacyPaneKind, ShellPermissionSnapshot, SystemSettingsBehavior, TccTriState } from '@/types/electron';

const PERM_ROWS: { key: keyof ShellPermissionSnapshot; pane: PrivacyPaneKind }[] = [
  { key: 'fullDisk', pane: 'fullDisk' },
  { key: 'screen', pane: 'screen' },
  { key: 'microphone', pane: 'microphone' },
  { key: 'accessibility', pane: 'accessibility' },
  { key: 'automation', pane: 'automation' },
  { key: 'notifications', pane: 'notifications' },
  { key: 'location', pane: 'location' },
];

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

export function SystemSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.systemSettings;

  const [behavior, setBehavior] = useState<SystemSettingsBehavior | null>(null);
  const [perms, setPerms] = useState<ShellPermissionSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const api = typeof window !== 'undefined' ? window.electronAPI?.system : undefined;

  const load = useCallback(async () => {
    if (!api) {
      return;
    }
    setLoadError(null);
    try {
      const b = await api.getBehavior();
      setBehavior(b);
      setPerms(await api.getPermissions());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

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
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const openPrivacy = async (kind: PrivacyPaneKind) => {
    try {
      const r = await api.openPrivacy(kind);
      if (!r.ok) {
        setLoadError('open_privacy failed');
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
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
        <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
      </div>

      {loadError ? (
        <p className="text-sm text-amber-600 dark:text-amber-400" role="alert">
          {loadError}
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
              disabled={!behavior}
              checked={Boolean(behavior?.notifyEnabled)}
              onChange={(e) => {
                void patchBehavior({ notifyEnabled: e.target.checked });
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
              className="mt-2 inline-flex max-w-full items-center justify-center rounded-lg border border-edge bg-surface-panel px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover sm:mt-0"
              onClick={() => void load()}
            >
              {t.refresh}
            </button>
          </div>
          <ul className="space-y-3">
            {PERM_ROWS.map(({ key, pane }) => {
              const st = triStateFromMessages(language, perms[key]);
              const permLabel = t.perm[key as keyof typeof t.perm];
              if (!permLabel) {
                return null;
              }
              return (
                <li
                  key={key}
                  className="flex flex-col gap-2 rounded-xl border border-edge-subtle bg-surface-panel/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-fg">{permLabel.title}</div>
                    <p className="mt-0.5 text-xs text-fg-muted">{permLabel.desc}</p>
                    <p className={`mt-1 text-xs font-medium ${st.className}`}>{st.label}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {key === 'microphone' && behavior?.platform === 'darwin' ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-edge bg-surface-base px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover"
                        onClick={() => {
                          void (async () => {
                            try {
                              await api.requestMicrophone();
                              setPerms(await api.getPermissions());
                            } catch (e) {
                              setLoadError(e instanceof Error ? e.message : String(e));
                            }
                          })();
                        }}
                      >
                        {language === 'zh' ? '请求访问' : 'Request'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface-base px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover"
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
    </div>
  );
}
