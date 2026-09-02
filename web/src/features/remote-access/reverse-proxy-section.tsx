import { Globe, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { revalidateGatewayConfig, useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import {
  patchReverseProxyPublicUrl,
  probeReverseProxyUrl,
  type ProbeReverseProxyResponse,
} from '@/features/remote-access/reverse-proxy-api';
import { useDetectedReverseProxyOrigin } from '@/features/remote-access/use-detected-reverse-proxy-origin';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

function configuredPublicUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const gateway = (value as { gateway?: unknown }).gateway;
  if (!gateway || typeof gateway !== 'object' || Array.isArray(gateway)) return null;
  const publicUrl = (gateway as { publicUrl?: unknown }).publicUrl;
  return typeof publicUrl === 'string' && publicUrl.trim() ? publicUrl.trim() : null;
}

export function ReverseProxySection() {
  const language = useLocaleStore((s) => s.language);
  const rp = messages(language).remoteAccess.reverseProxy;
  const token = useGatewayStore((s) => s.token);
  const hasToken = Boolean(token);
  const detected = useDetectedReverseProxyOrigin();
  const config = useGatewayConfigSwr(hasToken);
  const configuredUrl = configuredPublicUrl(config.data?.payload?.config);
  // Prefer an explicit draft, then the saved gateway origin, then the browser-detected origin.
  const [draftUrl, setDraftUrl] = useState<string>('');
  const [probeState, setProbeState] = useState<{
    busy: boolean;
    result: ProbeReverseProxyResponse | null;
  }>({ busy: false, result: null });
  const [savingState, setSavingState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });

  // Initialize draftUrl from configured value on first load; otherwise auto-detected.
  useEffect(() => {
    if (draftUrl) return;
    if (configuredUrl) {
      setDraftUrl(configuredUrl);
    } else if (detected) {
      setDraftUrl(detected);
    }
  }, [configuredUrl, detected, draftUrl]);

  const effectiveUrl = useMemo(() => {
    const v = draftUrl.trim();
    if (v) return v;
    return configuredUrl ?? detected ?? '';
  }, [configuredUrl, detected, draftUrl]);

  const isAutoDetectedOnly = !configuredUrl && Boolean(detected) && effectiveUrl === detected;

  const handleProbe = useCallback(async () => {
    const url = draftUrl.trim() || effectiveUrl;
    if (!url) return;
    setProbeState({ busy: true, result: null });
    try {
      const result = await probeReverseProxyUrl(url);
      setProbeState({ busy: false, result });
    } catch (error) {
      setProbeState({
        busy: false,
        result: {
          ok: false,
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }, [draftUrl, effectiveUrl]);

  const handleSaveAsDefault = useCallback(async () => {
    const url = effectiveUrl.trim();
    if (!url) return;
    setSavingState({ busy: true, error: null });
    try {
      await patchReverseProxyPublicUrl(url);
      await revalidateGatewayConfig();
      setSavingState({ busy: false, error: null });
    } catch (error) {
      setSavingState({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [effectiveUrl]);

  const handleClear = useCallback(async () => {
    setSavingState({ busy: true, error: null });
    try {
      await patchReverseProxyPublicUrl(null);
      await revalidateGatewayConfig();
      setDraftUrl('');
      setProbeState({ busy: false, result: null });
      setSavingState({ busy: false, error: null });
    } catch (error) {
      setSavingState({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  if (!hasToken) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Globe} title={rp.title} subtitle={rp.subtitle} />

        <div className="mt-4 space-y-3">
          <label className="text-sm font-medium text-fg" htmlFor="reverse-proxy-url">
            {rp.urlLabel}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <input
              id="reverse-proxy-url"
              className={cn(inputClassName(), 'font-mono text-xs sm:flex-1 sm:min-w-0 sm:w-auto')}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={rp.urlPlaceholder}
              value={draftUrl}
              onChange={(e) => {
                setDraftUrl(e.target.value);
                setProbeState({ busy: false, result: null });
              }}
            />
            <Button
              type="button"
              variant="secondary"
              className="shrink-0 whitespace-nowrap"
              onClick={() => void handleProbe()}
              disabled={probeState.busy || !draftUrl.trim()}
            >
              {probeState.busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {probeState.busy ? rp.probing : rp.probeButton}
            </Button>
          </div>
          <p className="text-xs text-fg-subtle">{rp.urlHint}</p>

          {isAutoDetectedOnly && detected ? (
            <div className="rounded-lg border border-accent/40 bg-accent-soft/50 px-3 py-2 text-xs leading-relaxed text-accent-fg">
              <div className="font-medium">{rp.autoDetectedTitle}</div>
              <div className="mt-1 break-all font-mono text-[11px]">{detected}</div>
              <p className="mt-1">{rp.autoDetectedHint}</p>
            </div>
          ) : null}

          {probeState.result ? (
            <ProbeResultPill
              result={probeState.result}
              labels={rp.probeStatus}
            />
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {effectiveUrl && (configuredUrl !== effectiveUrl) ? (
              <Button
                type="button"
                onClick={() => void handleSaveAsDefault()}
                disabled={savingState.busy}
              >
                {savingState.busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {savingState.busy ? rp.saving : rp.saveAsDefault}
              </Button>
            ) : null}
            {configuredUrl ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handleClear()}
                disabled={savingState.busy}
              >
                {rp.clear}
              </Button>
            ) : null}
          </div>
          {savingState.error ? (
            <p className="text-xs text-red-800 dark:text-red-200">{savingState.error}</p>
          ) : null}

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
            {rp.certWarning}
          </div>
        </div>
      </SettingsFormSection>

    </div>
  );
}

type ProbeStatusLabels = {
  ok: string;
  gatewayReady: string;
  codeUnknown: string;
  [code: `code_${string}`]: string;
};

function ProbeResultPill({
  result,
  labels,
}: {
  result: ProbeReverseProxyResponse;
  labels: ProbeStatusLabels;
}) {
  if (result.ok) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-100">
        <span className="font-medium">{labels.ok}</span>
        {' · '}
        <span className="font-mono">{result.latencyMs}ms</span>
        {result.gatewayReady ? (
          <>
            {' · '}
            <span>{labels.gatewayReady}</span>
          </>
        ) : null}
      </div>
    );
  }
  const key = `code_${result.code}` as const;
  const codeLabel = (labels as Record<string, string>)[key] ?? labels.codeUnknown;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-100">
      <span className="font-medium">{codeLabel}</span>
      {result.message ? (
        <>
          {' — '}
          <span className="font-mono break-all">{result.message}</span>
        </>
      ) : null}
    </div>
  );
}
