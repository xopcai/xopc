import { Globe, Monitor, MousePointer2, ShieldCheck, Square } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { messages } from '@/i18n/messages';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { isComputerUseAvailable } from '@/lib/electron-env';
import { useLocaleStore } from '@/stores/locale-store';
import { ComputerModelSettings } from './computer-model-settings';

type DesktopStatus = Awaited<ReturnType<NonNullable<NonNullable<Window['electronAPI']>['computer']>['status']>>;
type ComputerAccess = Awaited<ReturnType<NonNullable<NonNullable<Window['electronAPI']>['computer']>['access']>>;

function SettingRow({ icon, title, description, children }: {
  icon?: ReactNode; title: string; description?: ReactNode; children?: ReactNode;
}) {
  return <div className="flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap sm:p-5">
    {icon && <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-base/70 text-fg-muted" aria-hidden>{icon}</div>}
    <div className="min-w-0 flex-1">
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      {description && <div className="mt-1 text-sm leading-relaxed text-fg-muted">{description}</div>}
    </div>
    {children && <div className="flex shrink-0 items-center gap-3">{children}</div>}
  </div>;
}

export function ComputerSettingsPage() {
  const language = useLocaleStore(state => state.language);
  return <ComputerSettingsPanel zh={language === 'zh'} />;
}

export function ComputerSettingsPanel({ zh }: { zh: boolean }) {
  const t = messages(zh ? 'zh' : 'en').computerSettings;
  const { data, mutate, error: loadError } = useGatewayConfigSwr(true);
  const config = data?.payload?.config as { computer?: { enabled?: boolean }; browser?: { enabled?: boolean } } | undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(false);
  const [desktop, setDesktop] = useState<DesktopStatus | null>(null);
  const [nativeError, setNativeError] = useState(false);
  const [access, setAccess] = useState<ComputerAccess | null>(null);
  const [accessError, setAccessError] = useState(false);
  const [appSearch, setAppSearch] = useState('');
  const native = window.electronAPI?.platform === 'darwin' ? window.electronAPI.computer : undefined;
  const system = window.electronAPI?.platform === 'darwin' ? window.electronAPI.system : undefined;
  useEffect(() => {
    if (!native) return;
    let stopped = false;
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await native.status();
        if (!stopped) { setDesktop(result); setNativeError(false); }
      } catch {
        if (!stopped) { setDesktop(null); setNativeError(true); }
      } finally { polling = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [native]);
  useEffect(() => {
    if (!native?.access) return;
    let cancelled = false;
    void native.access().then(value => { if (!cancelled) { setAccess(value); setAccessError(false); } }).catch(() => { if (!cancelled) setAccessError(true); });
    return () => { cancelled = true; };
  }, [native]);

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const saveEnabled = (enabled: boolean) => perform(async () => {
    if (!isComputerUseAvailable()) return;
    await fetchJson(apiUrl('/api/config'), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ computer: { enabled } }),
    });
    await mutate();
  });
  // The emergency stop must remain available while another settings action is pending.
  const stop = async () => {
    setError(''); setNotice(false);
    try { await native?.stop(); setNotice(true); if (native) setDesktop(await native.status()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const sessionStatus = desktop?.session?.status ?? 'idle';
  const sessionLabel = t.states[sessionStatus as keyof typeof t.states] ?? sessionStatus;
  const controlEnabled = isComputerUseAvailable() && config?.computer?.enabled === true;

  return <SettingsPageFrame gap="gap-7">
    <SettingsPageHeader title={t.title} subtitle={t.subtitle}
      meta={<div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex rounded-md border border-edge px-2 py-1 text-xs text-fg-muted">{t.experimental}</span>
          <span className="inline-flex rounded-md border border-edge px-2 py-1 text-xs text-fg-muted">{t.preview}</span>
        </div>
        <p className="text-sm leading-relaxed text-fg-muted">{t.experimentalDescription}</p>
      </div>}
      actions={native && <Button onClick={() => { void stop(); }}><Square className="size-3.5" />{t.stop}</Button>} />

    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {notice && <p role="status" className="text-sm text-fg-muted">{t.stoppedNotice}</p>}
    {desktop?.controlPaused && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warning-soft p-4">
      <p className="text-sm text-fg-muted">{t.pausedNotice}</p>
      <Button disabled={busy} onClick={() => { void perform(async () => { if (native) setDesktop(await native.resume()); setNotice(false); }); }}>{t.resume}</Button>
    </div>}

    <ComputerModelSettings zh={zh} />

    <section aria-labelledby="computer-control-title" className="space-y-3">
      <h2 id="computer-control-title" className="text-sm font-semibold text-fg">{t.control}</h2>
      {!config && !loadError ? <Skeleton className="h-40 w-full rounded-xl" /> : loadError ?
        <div role="alert" className="text-sm text-fg-muted">{String(loadError)} <Button onClick={() => { void perform(() => mutate()); }}>{t.retry}</Button></div> :
        <div className="flex flex-col gap-1 rounded-xl bg-surface-hover/20 p-1 [&>*]:rounded-lg [&>*]:bg-surface-base/45">
          <SettingRow icon={<MousePointer2 className="size-5" />} title={t.desktop} description={t.desktopDescription}>
            <button type="button" role="switch" aria-label={t.desktop} aria-checked={controlEnabled}
              disabled={busy || !isComputerUseAvailable()} onClick={() => { void saveEnabled(config?.computer?.enabled !== true); }}
              className="touch-target flex items-center rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
              <span className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${controlEnabled ? 'bg-accent' : 'bg-fg-muted/30'}`}>
                <span className={`size-5 rounded-full bg-white transition-transform ${controlEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </span>
            </button>
          </SettingRow>
          <SettingRow icon={<Globe className="size-5" />} title={t.browser} description={<>{t.browserDescription}<span className="mt-1 block text-xs">{config?.browser?.enabled ? t.browserEnabled : t.browserDisabled}</span></>}>
            <Button asChild><Link to="/settings/agent-browser">{t.manage}</Link></Button>
          </SettingRow>
        </div>}
      <p className="text-xs leading-relaxed text-fg-muted">{t.safety} {t.lockedDescription}</p>
    </section>

    {native?.access && <section aria-labelledby="computer-app-access-title" className="space-y-3">
      <h2 id="computer-app-access-title" className="text-sm font-semibold text-fg">{t.appAccess}</h2>
      <p className="text-sm leading-relaxed text-fg-muted">{t.appAccessDescription}</p>
      <div className="flex gap-2">
        <input aria-label={t.searchApps} value={appSearch} onChange={event => setAppSearch(event.target.value)} placeholder={t.searchApps}
          className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg" />
        <Button disabled={busy} onClick={() => { void perform(async () => { setAccess(await native.access()); setAccessError(false); }); }}>{t.refreshApps}</Button>
      </div>
      {access ? <div className="max-h-72 overflow-y-auto rounded-xl border border-edge">
        {access.apps.filter(item => `${item.name} ${item.appId}`.toLocaleLowerCase().includes(appSearch.toLocaleLowerCase())).map(item => {
          const allowed = access.authorizedAppIds.includes(item.appId);
          return <div key={item.appId} className="flex items-center justify-between gap-3 border-b border-edge-subtle p-3 last:border-b-0">
            <div className="min-w-0"><p className="truncate text-sm font-medium text-fg">{item.name}</p><p className="truncate text-xs text-fg-muted">{item.appId}</p></div>
            <Button disabled={busy} variant={allowed ? 'secondary' : 'primary'} onClick={() => { void perform(async () => {
              const updated = await native.setAppAccess(item.appId, !allowed);
              setAccess(current => current ? { ...current, authorizedAppIds: updated.authorizedAppIds } : current);
            }); }}>{allowed ? t.revokeApp : t.authorizeApp}</Button>
          </div>;
        })}
      </div> : accessError ? <p role="alert" className="text-sm text-danger">{t.appListError}</p> : <Skeleton className="h-28 w-full rounded-xl" />}
    </section>}

    <section aria-labelledby="computer-permissions-title" className="space-y-3">
      <h2 id="computer-permissions-title" className="text-sm font-semibold text-fg">{t.permissions}</h2>
      {!native ? <p className="rounded-xl bg-surface-hover/20 p-5 text-sm leading-relaxed text-fg-muted">{window.electronAPI && window.electronAPI.platform !== 'darwin' ? t.unsupportedPlatform : t.desktopRequired}</p> :
        nativeError ? <p role="alert" className="rounded-xl bg-danger-soft p-5 text-sm text-danger">{t.nativeError}</p> :
        !desktop ? <div aria-label={t.checking}><Skeleton className="h-52 w-full rounded-xl" /></div> :
        <div className="flex flex-col gap-1 rounded-xl bg-surface-hover/20 p-1 [&>*]:rounded-lg [&>*]:bg-surface-base/45">
          <SettingRow icon={<Monitor className="size-5" />} title={t.device} description={<>
            <span aria-live="polite">{desktop.connected ? t.connected : t.disconnected} · {sessionLabel}</span>
            {desktop.reenrollmentRequired && <p className="mt-1">{t.revoked}</p>}
          </>}>
            {desktop.reenrollmentRequired && <Button disabled={busy} onClick={() => { void perform(async () => { setDesktop(await native.reenroll()); }); }}>{t.reenroll}</Button>}
          </SettingRow>
          {system && <>
            <SettingRow icon={<ShieldCheck className="size-5" />} title={t.accessibility} description={t.accessibilityDescription}>
              <span className="text-xs text-fg-muted">{desktop.permissions.accessibility ? t.granted : t.notGranted}</span>
              {!desktop.permissions.accessibility && <Button disabled={busy} aria-label={`${t.openSettings}: ${t.accessibility}`} onClick={() => { void perform(() => system.requestAccessibility()); }}>{t.openSettings}</Button>}
            </SettingRow>
            <SettingRow icon={<Monitor className="size-5" />} title={t.screen} description={t.screenDescription}>
              <span className="text-xs text-fg-muted">{desktop.permissions.screenRecording === 'granted' ? t.granted : t.notGranted}</span>
              {desktop.permissions.screenRecording !== 'granted' && <Button disabled={busy} aria-label={`${t.openSettings}: ${t.screen}`} onClick={() => { void perform(() => system.requestScreen()); }}>{t.openSettings}</Button>}
            </SettingRow>
          </>}
        </div>}
      {(desktop?.error || desktop?.session?.errorCode) && <p role="alert" className="break-words text-sm text-red-600">{desktop.error || desktop.session?.errorCode}</p>}
    </section>

  </SettingsPageFrame>;
}
