import { Image as ImageIcon, Loader2, RefreshCw, Save, Server } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  fetchAgentDefaults,
  patchAgentDefaults,
  type AgentDefaultsState,
} from '@/features/settings/config-api';
import {
  SettingsFormSection,
  SettingsFormSectionHeader,
} from '@/features/settings/settings-form-section';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

interface ImageGenProviderSummary {
  id: string;
  label?: string;
  defaultModel?: string;
  models: string[];
  aliases?: string[];
  configured?: boolean;
  capabilities?: unknown;
}

function inputClass(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
  );
}

const PROVIDERS_SWR_KEY = '/api/image/providers';

async function fetchImageProviders(): Promise<ImageGenProviderSummary[]> {
  const res = await fetchJson<{
    ok?: boolean;
    payload?: { providers?: ImageGenProviderSummary[] };
  }>(apiUrl(PROVIDERS_SWR_KEY));
  return res?.payload?.providers ?? [];
}

export function ImageModelsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = (m as unknown as { imageModelsSettings: Record<string, string> }).imageModelsSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  // Load + persist agent defaults (image-generation knobs).
  const [state, setState] = useState<AgentDefaultsState | null>(null);
  const [baseline, setBaseline] = useState<AgentDefaultsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const reload = useCallback(async () => {
    if (!hasToken) return;
    setLoading(true);
    setError(undefined);
    try {
      const fresh = await fetchAgentDefaults();
      setState(fresh);
      setBaseline(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [hasToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Provider catalogue (from /api/image/providers).
  const { data: providers = [], mutate: refreshProviders } = useSWR<ImageGenProviderSummary[]>(
    hasToken ? PROVIDERS_SWR_KEY : null,
    fetchImageProviders,
    { revalidateOnFocus: false },
  );

  // Tie config-payload SWR cache so other panels see our edits.
  const gwSwr = useGatewayConfigSwr(false);

  // Only the knobs unique to this panel are dirty-tracked; the primary model +
  // fallback chain belong to /settings/agent-defaults to avoid two panels
  // racing on the same `agents.defaults.imageGenerationModel` field.
  const dirty = useMemo(() => {
    if (!state || !baseline) return false;
    return (
      state.imageGenerationModelTimeoutMs !== baseline.imageGenerationModelTimeoutMs ||
      state.imageGenerationModelAutoProviderFallback !==
        baseline.imageGenerationModelAutoProviderFallback
    );
  }, [state, baseline]);

  const onSave = useCallback(async () => {
    if (!state) return;
    setSaving(true);
    setError(undefined);
    try {
      await patchAgentDefaults(state);
      setBaseline(state);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
      // Refresh shared SWR cache so models / agent-defaults panels stay in sync.
      void gwSwr.mutate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [state, gwSwr]);

  if (!hasToken) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-8 text-sm text-fg-muted">
        {language === 'zh' ? '请先登录网关。' : 'Connect to a gateway to continue.'}
      </div>
    );
  }

  if (loading || !state) {
    return (
      <div className="mx-auto flex w-full max-w-app-main items-center gap-2 px-4 py-8 text-sm text-fg-muted">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-fg">{t.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            void reload();
            void refreshProviders();
          }}
        >
          <RefreshCw className="size-3.5" />
          <span className="ml-1.5">{t.refresh}</span>
        </Button>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={ImageIcon} title={t.title} subtitle={t.subtitle} />
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-edge-subtle bg-surface-base px-3 py-2.5 text-xs leading-relaxed text-fg-muted">
            {t.crossLinkHint}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-fg">{t.timeoutLabel}</label>
            <input
              type="number"
              min={0}
              step={1000}
              className={cn(inputClass(), 'max-w-[12rem]')}
              value={state.imageGenerationModelTimeoutMs ?? ''}
              placeholder="120000"
              onChange={(e) => {
                const raw = e.target.value.trim();
                const next = raw === '' ? null : Math.max(0, Math.floor(Number(raw)));
                setState({
                  ...state,
                  imageGenerationModelTimeoutMs: next && next > 0 ? next : null,
                });
              }}
            />
            <p className="text-xs text-fg-subtle">{t.timeoutHint}</p>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={state.imageGenerationModelAutoProviderFallback}
              onChange={(e) =>
                setState({
                  ...state,
                  imageGenerationModelAutoProviderFallback: e.target.checked,
                })
              }
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-fg">{t.autoFallbackLabel}</span>
              <span className="text-xs text-fg-subtle">{t.autoFallbackHint}</span>
            </span>
          </label>
          <div className="flex items-center gap-2 pt-2">
            <Button onClick={onSave} disabled={!dirty || saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              <span className="ml-1.5">{t.save}</span>
            </Button>
            {savedFlash ? (
              <span className="text-xs text-accent-fg">{t.saved}</span>
            ) : null}
          </div>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Server} title={t.providersTitle} subtitle="" />
        {providers.length === 0 ? (
          <p className="text-sm text-fg-muted">{t.providersEmpty}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {providers.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-edge bg-surface-panel px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-fg">{p.label ?? p.id}</span>
                    <span className="text-xs text-fg-subtle">({p.id})</span>
                  </div>
                  {p.configured ? (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-fg">
                      {t.configured}
                    </span>
                  ) : (
                    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                      {t.missingKey}
                    </span>
                  )}
                </div>
                {p.defaultModel ? (
                  <p className="mt-1 text-xs text-fg-subtle">
                    <span className="text-fg-muted">{t.defaultModel}:</span> {p.id}/{p.defaultModel}
                  </p>
                ) : null}
                {p.models.length > 0 ? (
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    <span className="text-fg-muted">{t.modelsLabel}:</span>{' '}
                    {p.models.map((mm) => `${p.id}/${mm}`).join(', ')}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </SettingsFormSection>
    </div>
  );
}
