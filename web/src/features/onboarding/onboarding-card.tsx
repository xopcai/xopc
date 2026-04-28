import { ExternalLink } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { ConfiguredModel } from '@/features/chat/registry-api';
import { fetchConfiguredModelsCached, invalidateConfiguredModelsCache } from '@/features/chat/registry-api';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { OnboardingModelSelect } from '@/features/onboarding/onboarding-model-select';
import { OnboardingProviderGrid } from '@/features/onboarding/onboarding-provider-grid';
import { PROVIDER_ENRICHMENT } from '@/features/settings/provider-enrichment';
import { patchProviderApiKeys } from '@/features/settings/providers-api';
import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

interface OnboardingCardProps {
  onComplete: () => void;
  onDismiss: () => void;
}

export function OnboardingCard({ onComplete, onDismiss }: OnboardingCardProps) {
  const language = useLocaleStore((s) => s.language);
  const o = messages(language).onboarding;

  const [step, setStep] = useState<'provider' | 'apiKey' | 'model'>('provider');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [models, setModels] = useState<ConfiguredModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);

  const stepLabel = useMemo(
    () => o.stepOf.replace('{{current}}', String(step === 'provider' ? 1 : step === 'apiKey' ? 2 : 3)).replace('{{total}}', '3'),
    [o.stepOf, step],
  );

  const loadModels = useCallback(async (providerId: string) => {
    setModelsLoading(true);
    setError(null);
    try {
      const list = await fetchConfiguredModelsCached(true);
      const filtered = list.filter((m) => m.provider === providerId);
      setModels(filtered);
      setSelectedModelId(filtered[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setModels([]);
      setSelectedModelId(null);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const onContinueApiKey = async () => {
    if (!selectedProvider || !apiKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await patchProviderApiKeys({ [selectedProvider]: apiKey.trim() });
      await loadModels(selectedProvider);
      setStep('model');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onStartChatting = async () => {
    if (!selectedProvider || !selectedModelId) return;
    const modelRef = models.find((m) => m.id === selectedModelId)?.id ?? selectedModelId;
    setBusy(true);
    setError(null);
    try {
      await fetchJson(apiUrl('/api/config'), {
        method: 'PATCH',
        body: JSON.stringify({
          agents: {
            defaults: {
              model: modelRef,
            },
          },
        }),
      });
      void revalidateGatewayConfig();
      void invalidateConfiguredModelsCache();
      window.dispatchEvent(new CustomEvent('config-reload'));
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-xl rounded-2xl border border-edge bg-surface-panel p-6 shadow-elevated">
      <div className="text-center">
        <div className="text-3xl" aria-hidden>
          🤖
        </div>
        <h2 className="mt-3 text-lg font-semibold tracking-tight text-fg">{o.title}</h2>
        <p className="mt-1 text-sm text-fg-muted">{o.subtitle}</p>
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-fg-muted">{stepLabel}</p>
      </div>

      <div className="mt-6">
        {step === 'provider' ? (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-base font-medium text-fg">{o.step1Title}</h3>
              <p className="mt-1 text-sm text-fg-muted">{o.step1Subtitle}</p>
            </div>
            <OnboardingProviderGrid
              onSelect={(id) => {
                setSelectedProvider(id);
                setStep('apiKey');
                setApiKey('');
                setError(null);
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <Link
                to="/settings/providers"
                className="text-xs font-medium text-accent-fg hover:underline"
              >
                {language === 'zh' ? '高级设置…' : 'More settings…'}
              </Link>
              <button
                type="button"
                className="text-xs font-medium text-fg-muted hover:text-fg hover:underline"
                onClick={onDismiss}
              >
                {o.skipSetup}
              </button>
            </div>
          </div>
        ) : null}

        {step === 'apiKey' ? (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-base font-medium text-fg">
                {o.step2Title}
                {selectedProvider ? ` (${selectedProvider})` : ''}
              </h3>
              <p className="mt-1 text-sm text-fg-muted">{o.step2Subtitle}</p>
            </div>
            {selectedProvider && (() => {
              const enrichment = PROVIDER_ENRICHMENT[selectedProvider];
              const apiKeyUrl = enrichment?.apiKeyUrl;
              const apiKeyUrlCn = enrichment?.apiKeyUrlCn;
              if (!apiKeyUrl) return null;
              return (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-edge-subtle bg-surface-base px-3.5 py-2.5">
                  <span className="text-xs text-fg-muted">
                    {language === 'zh' ? '获取 API Key：' : 'Get your API Key:'}
                  </span>
                  <a
                    href={apiKeyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent-fg hover:underline"
                  >
                    {apiKeyUrlCn
                      ? (language === 'zh' ? '国际版' : 'International')
                      : (language === 'zh' ? '前往获取' : 'Get API Key')}
                    <ExternalLink className="size-3" />
                  </a>
                  {apiKeyUrlCn && (
                    <a
                      href={apiKeyUrlCn}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-accent-fg hover:underline"
                    >
                      {language === 'zh' ? '中国版' : 'China'}
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              );
            })()}
            <label className="block text-sm font-medium text-fg">
              <span className="sr-only">{o.step2Placeholder}</span>
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={o.step2Placeholder}
                className="mt-1 w-full rounded-xl border border-edge bg-surface-panel px-3 py-2.5 text-sm text-fg outline-none ring-accent placeholder:text-fg-muted focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <p className="text-xs text-fg-muted">{o.step2SecurityNote}</p>
            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setStep('provider')}>
                {o.back}
              </Button>
              <Button
                type="button"
                className="bg-accent text-white hover:bg-accent/90"
                disabled={busy || !apiKey.trim()}
                onClick={() => void onContinueApiKey()}
              >
                {o.continue}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'model' ? (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-base font-medium text-fg">{o.step3Title}</h3>
              <p className="mt-1 text-sm text-fg-muted">{o.step3Subtitle}</p>
            </div>
            {modelsLoading ? (
              <p className="text-sm text-fg-muted">{language === 'zh' ? '加载模型…' : 'Loading models…'}</p>
            ) : error && models.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                <button
                  type="button"
                  className="text-left text-sm font-medium text-accent-fg hover:underline"
                  onClick={() => selectedProvider && void loadModels(selectedProvider)}
                >
                  {language === 'zh' ? '重试' : 'Retry'}
                </button>
              </div>
            ) : (
              <OnboardingModelSelect
                models={models}
                selectedId={selectedModelId}
                onSelectedChange={setSelectedModelId}
              />
            )}
            {error && models.length > 0 ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setStep('apiKey')}>
                {o.back}
              </Button>
              <Button
                type="button"
                className="bg-accent text-white hover:bg-accent/90"
                disabled={busy || !selectedModelId || modelsLoading}
                onClick={() => void onStartChatting()}
              >
                {o.startChatting}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
