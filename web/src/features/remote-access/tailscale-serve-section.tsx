import { Globe, Loader2, Power } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { CopyTextRow } from '@/components/ui/copy-text-row';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { RemoteAccessDocsLink } from '@/features/remote-access/remote-access-docs-link';
import {
  fetchExposureStatus,
  startTailscaleExposure,
  stopTailscaleExposure,
} from '@/features/remote-access/remote-access-api';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';

function TailscaleDownloadLink({ label }: { label: string }) {
  return (
    <a
      href={TAILSCALE_DOWNLOAD_URL}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-accent hover:underline"
    >
      {label}
    </a>
  );
}

export function TailscaleServeSection({ embedded = false }: { embedded?: boolean }) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).remoteAccess.tailscale;
  const copyLabels = useMemo(
    () => ({
      copy: t.copyUrl,
      copied: t.copied,
      copyFailed: messages(language).clipboard.copyFailed,
    }),
    [language, t.copyUrl, t.copied],
  );
  const hasToken = Boolean(useGatewayStore((s) => s.token));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, mutate, isLoading } = useSWR(
    hasToken ? 'exposure-status' : null,
    fetchExposureStatus,
    { refreshInterval: 30_000 },
  );

  const hostname = data?.tailscale.hostname;
  const active = data?.tailscale.active === true;
  const cliAvailable = data?.tailscale.cliAvailable !== false;
  const publicUrl = hostname ? `https://${hostname}/` : null;

  const onStart = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await startTailscaleExposure('serve');
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [mutate]);

  const onStop = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await stopTailscaleExposure();
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [mutate]);

  if (!hasToken) {
    return null;
  }

  const body = (
    <div className={embedded ? 'space-y-4' : 'mt-4 space-y-3'}>
      {embedded ? (
        <ol className="space-y-3 text-sm text-fg-muted">
          <li className="flex gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-fg">
              1
            </span>
            <span>
              {t.stepInstallBefore}
              <TailscaleDownloadLink label={t.stepInstallLink} />
              {t.stepInstallAfter}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-fg">
              2
            </span>
            <span>{t.stepEnable}</span>
          </li>
          <li className="flex gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-fg">
              3
            </span>
            <span>{t.stepCopy}</span>
          </li>
        </ol>
      ) : null}

      {embedded && data?.tailscale.cliAvailable === false ? (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm text-fg-muted">
          {t.cliMissingIntro}{' '}
          <TailscaleDownloadLink label={t.cliMissingDownloadLink} />
          {t.cliMissingSuffix}
        </p>
      ) : null}

      {isLoading && !data ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      ) : (
        <>
          <SettingsFormSection>
            <p className="text-sm font-medium text-fg">{t.statusLabel}</p>
            <p className="mt-1 text-sm text-fg-muted">{active ? t.statusActive : t.statusOff}</p>
            {publicUrl ? (
              <div className="mt-3">
                <CopyTextRow text={publicUrl} labels={copyLabels} />
              </div>
            ) : null}
            {error ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {!active ? (
                <Button type="button" disabled={busy || !cliAvailable} onClick={() => void onStart()}>
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Power className="mr-1 h-4 w-4" />}
                  {t.enableServe}
                </Button>
              ) : (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void onStop()}>
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  {t.disableServe}
                </Button>
              )}
            </div>
          </SettingsFormSection>
          <p className="text-xs text-fg-subtle">{t.hint}</p>
          <RemoteAccessDocsLink language={language} label={t.docsLink} section="tailscale-serve" className="mt-2" />
        </>
      )}
    </div>
  );

  if (embedded) {
    return body;
  }

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader icon={Globe} title={t.title} subtitle={t.subtitle} />
      {body}
    </SettingsFormSection>
  );
}
