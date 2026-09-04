import { CheckCircle2, CircleAlert, Download, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { messages } from '@/i18n/messages';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { SettingsPageSkeleton } from '@/features/settings/settings-loading-skeleton';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import {
  runRuntimeOperation,
  pruneRuntimeTools,
  saveRuntimeToolsConfig,
  type RuntimeKind,
  type RuntimeProgress,
  type RuntimeStatus,
  type RuntimeToolsConfig,
} from './runtime-tools-api';

const RUNTIMES: RuntimeKind[] = ['node', 'python', 'uv'];

export function RuntimeToolsSettingsPanel() {
  const language = useLocaleStore((state) => state.language);
  const t = messages(language).runtimeToolsSettings;
  const { data, error, isLoading, mutate } = useSWR<{
    ok: true;
    payload: { config: RuntimeToolsConfig; statuses: RuntimeStatus[] };
  }>(apiUrl('/api/runtime-tools'));
  const [draft, setDraft] = useState<RuntimeToolsConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [running, setRunning] = useState<RuntimeKind | null>(null);
  const [progress, setProgress] = useState<Partial<Record<RuntimeKind, RuntimeProgress>>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.payload.config) setDraft(structuredClone(data.payload.config));
  }, [data?.payload.config]);

  if (error) {
    return (
      <SettingsPageFrame>
        <SettingsPageHeader title={t.title} subtitle={t.loadError} />
        <Button onClick={() => void mutate()}>{t.refresh}</Button>
      </SettingsPageFrame>
    );
  }
  if (isLoading || !draft) {
    return <SettingsPageFrame><SettingsPageSkeleton sections={3} /></SettingsPageFrame>;
  }

  const statusMap = new Map(data?.payload.statuses.map((status) => [status.runtime, status]));
  const updateLanguage = (
    runtime: 'node' | 'python',
    patch: Partial<RuntimeToolsConfig['node']>,
  ) => setDraft((current) => current ? {
    ...current,
    [runtime]: { ...current[runtime], ...patch },
  } : current);

  const save = async () => {
    setSaving(true);
    setActionError(null);
    try {
      await saveRuntimeToolsConfig(draft);
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const operate = async (runtime: RuntimeKind, action: 'install' | 'repair') => {
    setRunning(runtime);
    setActionError(null);
    try {
      await saveRuntimeToolsConfig(draft);
      const version = runtime === 'uv' ? draft.uv.version : draft[runtime].version;
      await runRuntimeOperation({
        runtime,
        action,
        version,
        onProgress: (event) => setProgress((current) => ({ ...current, [runtime]: event })),
      });
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(null);
    }
  };

  const prune = async () => {
    setPruning(true);
    setActionError(null);
    try {
      await pruneRuntimeTools();
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPruning(false);
    }
  };

  return (
    <SettingsPageFrame gap="gap-6">
      <SettingsPageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={(
          <>
            <Button onClick={() => void mutate()} disabled={running !== null}>
              <RefreshCw className="size-4" />{t.refresh}
            </Button>
            <Button onClick={() => void prune()} disabled={pruning || running !== null}>
              {pruning ? t.pruning : t.prune}
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving || running !== null}>
              {saving ? t.saving : t.save}
            </Button>
          </>
        )}
      />

      {actionError ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {actionError}
        </div>
      ) : null}

      <section className="rounded-xl border border-edge bg-surface-subtle p-4">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-fg">{t.enabled}</span>
            <span className="mt-1 block text-xs text-fg-muted">{t.enabledHint}</span>
          </span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            className="size-4 accent-accent"
          />
        </label>
      </section>

      <section className="grid gap-4 rounded-xl border border-edge bg-surface-subtle p-4 md:grid-cols-2">
        <label className="space-y-1.5 text-xs font-medium text-fg-muted">
          {t.downloadSource}
          <Select
            value={draft.download.source}
            onChange={(event) => setDraft({
              ...draft,
              download: {
                ...draft.download,
                source: event.target.value as RuntimeToolsConfig['download']['source'],
              },
            })}
          >
            <SelectOption value="auto">{t.downloadSources.auto}</SelectOption>
            <SelectOption value="website-only">{t.downloadSources.websiteOnly}</SelectOption>
            <SelectOption value="direct-only">{t.downloadSources.directOnly}</SelectOption>
          </Select>
        </label>
        <label className="space-y-1.5 text-xs font-medium text-fg-muted">
          {t.gatewayBaseUrl}
          <input
            value={draft.download.gatewayBaseUrl}
            disabled={draft.download.source === 'direct-only'}
            onChange={(event) => setDraft({
              ...draft,
              download: { ...draft.download, gatewayBaseUrl: event.target.value },
            })}
            className="h-10 w-full rounded-lg border border-edge bg-surface-panel px-3 text-sm text-fg outline-none focus:border-edge-strong disabled:opacity-50"
          />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-fg-muted">
          {t.offlineBundle}
          <input
            value={draft.download.bundleDir ?? ''}
            placeholder={t.offlineBundlePlaceholder}
            onChange={(event) => setDraft({
              ...draft,
              download: { ...draft.download, bundleDir: event.target.value || undefined },
            })}
            className="h-10 w-full rounded-lg border border-edge bg-surface-panel px-3 text-sm text-fg outline-none focus:border-edge-strong"
          />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-fg-muted">
          {t.proxy}
          <input
            value={draft.download.proxy ?? ''}
            placeholder="http://127.0.0.1:7890"
            onChange={(event) => setDraft({
              ...draft,
              download: { ...draft.download, proxy: event.target.value || undefined },
            })}
            className="h-10 w-full rounded-lg border border-edge bg-surface-panel px-3 text-sm text-fg outline-none focus:border-edge-strong"
          />
        </label>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        {RUNTIMES.map((runtime) => {
          const status = statusMap.get(runtime);
          const isReady = status?.state === 'ready';
          const currentProgress = progress[runtime];
          const runtimeConfig = runtime === 'uv' ? draft.uv : draft[runtime];
          return (
            <section key={runtime} className="flex min-w-0 flex-col gap-4 rounded-xl border border-edge bg-surface-panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-fg">{t.runtimeNames[runtime]}</h2>
                  <p className="mt-1 break-words text-xs text-fg-muted">{status?.message ?? t.unknown}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isReady
                    ? <CheckCircle2 className="size-5 shrink-0 text-success" />
                    : <CircleAlert className="size-5 shrink-0 text-warning" />}
                  <input
                    type="checkbox"
                    aria-label={`${t.runtimeNames[runtime]} ${t.enabled}`}
                    checked={runtimeConfig.enabled}
                    onChange={(event) => {
                      if (runtime === 'uv') {
                        setDraft({ ...draft, uv: { ...draft.uv, enabled: event.target.checked } });
                      } else {
                        updateLanguage(runtime, { enabled: event.target.checked });
                      }
                    }}
                    className="size-4 accent-accent"
                  />
                </div>
              </div>

              <label className="space-y-1.5 text-xs font-medium text-fg-muted">
                {t.version}
                <input
                  value={runtimeConfig.version ?? ''}
                  placeholder={status?.requestedVersion}
                  onChange={(event) => {
                    const version = event.target.value || undefined;
                    if (runtime === 'uv') setDraft({ ...draft, uv: { ...draft.uv, version } });
                    else updateLanguage(runtime, { version });
                  }}
                  className="h-10 w-full rounded-lg border border-edge bg-surface-subtle px-3 text-sm text-fg outline-none focus:border-edge-strong"
                />
              </label>

              {runtime !== 'uv' ? (
                <>
                  <label className="space-y-1.5 text-xs font-medium text-fg-muted">
                    {t.sourcePolicy}
                    <Select
                      value={draft[runtime].preference}
                      onChange={(event) => updateLanguage(runtime, {
                        preference: event.target.value as RuntimeToolsConfig['node']['preference'],
                      })}
                    >
                      <SelectOption value="managed-first">{t.preferences.managedFirst}</SelectOption>
                      <SelectOption value="system-first">{t.preferences.systemFirst}</SelectOption>
                      <SelectOption value="managed-only">{t.preferences.managedOnly}</SelectOption>
                      <SelectOption value="system-only">{t.preferences.systemOnly}</SelectOption>
                    </Select>
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-fg-muted">
                    {t.provisionPolicy}
                    <Select
                      value={draft[runtime].provision}
                      onChange={(event) => updateLanguage(runtime, {
                        provision: event.target.value as RuntimeToolsConfig['node']['provision'],
                      })}
                    >
                      <SelectOption value="eager">{t.provisions.eager}</SelectOption>
                      <SelectOption value="on-demand">{t.provisions.onDemand}</SelectOption>
                      <SelectOption value="disabled">{t.provisions.disabled}</SelectOption>
                    </Select>
                  </label>
                </>
              ) : null}

              {currentProgress && running === runtime ? (
                <div className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent-fg">
                  {currentProgress.message}
                  {currentProgress.totalBytes && currentProgress.downloadedBytes
                    ? ` · ${Math.round(currentProgress.downloadedBytes / currentProgress.totalBytes * 100)}%`
                    : ''}
                </div>
              ) : null}

              <div className="mt-auto flex gap-2">
                <Button
                  variant="primary"
                  disabled={!draft.enabled || !runtimeConfig.enabled || running !== null}
                  onClick={() => void operate(runtime, 'install')}
                >
                  <Download className="size-4" />{running === runtime ? t.working : t.install}
                </Button>
                {status?.repairable ? (
                  <Button
                    disabled={!draft.enabled || !runtimeConfig.enabled || running !== null}
                    onClick={() => void operate(runtime, 'repair')}
                  >
                    <RotateCcw className="size-4" />{t.repair}
                  </Button>
                ) : null}
              </div>
              {status?.resolved?.executable ? (
                <code className="break-all text-[11px] text-fg-subtle">{status.resolved.executable}</code>
              ) : null}
            </section>
          );
        })}
      </div>
    </SettingsPageFrame>
  );
}
