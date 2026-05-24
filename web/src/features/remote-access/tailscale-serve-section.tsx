import { Copy, Globe, Loader2, Power } from 'lucide-react';
import { useCallback, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import {
  fetchExposureStatus,
  startTailscaleExposure,
  stopTailscaleExposure,
} from '@/features/remote-access/remote-access-api';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

export function TailscaleServeSection() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).remoteAccess.tailscale;
  const hasToken = Boolean(useGatewayStore((s) => s.token));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, mutate, isLoading } = useSWR(
    hasToken ? 'exposure-status' : null,
    fetchExposureStatus,
    { refreshInterval: 30_000 },
  );

  const hostname = data?.tailscale.hostname;
  const active = data?.tailscale.active === true;
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

  const copyUrl = useCallback(async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [publicUrl]);

  if (!hasToken) {
    return null;
  }

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader icon={Globe} title={t.title} subtitle={t.subtitle} />
      <div className="mt-4 space-y-3">
        {isLoading && !data ? (
          <p className="text-sm text-fg-muted">{t.loading}</p>
        ) : (
          <>
            <p className="text-sm text-fg-muted">
              {active ? t.statusActive : t.statusOff}
              {publicUrl ? (
                <span className="ml-2 font-mono text-fg">{publicUrl}</span>
              ) : null}
            </p>
            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              {!active ? (
                <Button type="button" disabled={busy} onClick={() => void onStart()}>
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Power className="mr-1 h-4 w-4" />}
                  {t.enableServe}
                </Button>
              ) : (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void onStop()}>
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  {t.disableServe}
                </Button>
              )}
              {publicUrl ? (
                <Button type="button" variant="ghost" onClick={() => void copyUrl()}>
                  <Copy className="mr-1 h-4 w-4" />
                  {copied ? t.copied : t.copyUrl}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-fg-subtle">{t.hint}</p>
          </>
        )}
      </div>
    </SettingsFormSection>
  );
}
