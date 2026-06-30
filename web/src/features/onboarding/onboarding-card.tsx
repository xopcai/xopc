import { ExternalLink } from 'lucide-react';
import { useCallback, useMemo, useReducer } from 'react';
import { Link } from 'react-router-dom';

import type { ConfiguredModel } from '@/features/chat/api/registry-api';
import { fetchConfiguredModelsCached, invalidateConfiguredModelsCache } from '@/features/chat/api/registry-api';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { dispatchConfigReload } from '@/features/gateway/dispatch-config-reload';
import { OnboardingModelSelect } from '@/features/onboarding/onboarding-model-select';
import { OnboardingProviderGrid } from '@/features/onboarding/onboarding-provider-grid';
import { PROVIDER_ENRICHMENT } from '@/features/settings/provider-enrichment';
import { patchProviderApiKeys } from '@/features/settings/providers-api';
import { applyGatewayAgentsPayloadToCaches, fetchGatewayAgents, updateGatewayAgent } from '@/features/settings/agents-admin-api';
import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { secretInputLabelsFromChannels } from '@/lib/secret-input-labels';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

interface OnboardingCardProps {
  onComplete: () => void | Promise<void>;
  onDismiss: () => void;
}

type OnboardingState = {
  step: 'provider' | 'apiKey' | 'model';
  selectedProvider: string | null;
  apiKey: string;
  busy: boolean;
  error: string | null;
  models: ConfiguredModel[];
  selectedModelId: string | null;
  modelsLoading: boolean;
};

type OnboardingAction =
  | { type: 'patch'; patch: Partial<OnboardingState> }
  | { type: 'reset-models' };

const initialOnboarding: OnboardingState = {
  step: 'provider',
  selectedProvider: null,
  apiKey: '',
  busy: false,
  error: null,
  models: [],
  selectedModelId: null,
  modelsLoading: false,
};

function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };
    case 'reset-models':
      return { ...state, models: [], selectedModelId: null };
  }
}

export function OnboardingCard({ onComplete, onDismiss }: OnboardingCardProps) {
  const language = useLocaleStore((s) => s.language);
  const o = messages(language).onboarding;

  const [state, dispatch] = useReducer(onboardingReducer, initialOnboarding);
  const { step, selectedProvider, apiKey, busy, error, models, selectedModelId, modelsLoading } = state;

  const stepLabel = useMemo(
    () => o.stepOf.replace('{{current}}', String(step === 'provider' ? 1 : step === 'apiKey' ? 2 : 3)).replace('{{total}}', '3'),
    [o.stepOf, step],
  );

  const loadModels = useCallback(async (providerId: string) => {
    dispatch({ type: 'patch', patch: { modelsLoading: true, error: null } });
    try {
      const list = await fetchConfiguredModelsCached(true);
      const filtered = list
        .filter((m) => m.provider === providerId)
        .sort((a, b) => {
          if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
          return (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' });
        });
      dispatch({
        type: 'patch',
        patch: { models: filtered, selectedModelId: filtered[0]?.id ?? null },
      });
    } catch (e) {
      dispatch({
        type: 'patch',
        patch: {
          error: e instanceof Error ? e.message : String(e),
          models: [],
          selectedModelId: null,
        },
      });
    } finally {
      dispatch({ type: 'patch', patch: { modelsLoading: false } });
    }
  }, []);

  const onContinueApiKey = async () => {
    if (!selectedProvider || !apiKey.trim()) return;
    dispatch({ type: 'patch', patch: { busy: true, error: null } });
    try {
      await patchProviderApiKeys({ [selectedProvider]: apiKey.trim() });
      await loadModels(selectedProvider);
      dispatch({ type: 'patch', patch: { step: 'model' } });
    } catch (e) {
      dispatch({ type: 'patch', patch: { error: e instanceof Error ? e.message : String(e) } });
    } finally {
      dispatch({ type: 'patch', patch: { busy: false } });
    }
  };

  const onStartChatting = async () => {
    if (!selectedProvider || !selectedModelId) return;
    const modelRef = models.find((m) => m.id === selectedModelId)?.id ?? selectedModelId;
    dispatch({ type: 'patch', patch: { busy: true, error: null } });
    try {
      const agentsPayload = await fetchGatewayAgents();
      const defaultAgent = agentsPayload.agents.find((agent) => agent.id === agentsPayload.defaultId) ?? agentsPayload.agents[0];
      if (!defaultAgent) {
        throw new Error('No default agent configured');
      }
      const defaultRole = defaultAgent.typedModels.defaultRole || defaultAgent.typedModels.effective[0]?.id || 'deep';
      const roles = Object.fromEntries(
        defaultAgent.typedModels.effective.map((row) => [
          row.id,
          row.description ? { model: row.model, description: row.description } : { model: row.model },
        ]),
      );
      roles[defaultRole] = { ...(roles[defaultRole] ?? {}), model: modelRef };
      const updatedAgents = await updateGatewayAgent(defaultAgent.id, {
        models: { defaultRole, roles },
      });
      await applyGatewayAgentsPayloadToCaches(updatedAgents);
      void revalidateGatewayConfig();
      void invalidateConfiguredModelsCache();
      dispatchConfigReload();
      await onComplete();
    } catch (e) {
      dispatch({ type: 'patch', patch: { error: e instanceof Error ? e.message : String(e) } });
    } finally {
      dispatch({ type: 'patch', patch: { busy: false } });
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
                dispatch({
                  type: 'patch',
                  patch: { selectedProvider: id, step: 'apiKey', apiKey: '', error: null },
                });
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <Link
                to="/settings/credentials"
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
              <SecretInput
                className="mt-1"
                value={apiKey}
                onChange={(next) => dispatch({ type: 'patch', patch: { apiKey: next } })}
                placeholder={o.step2Placeholder}
                labels={secretInputLabelsFromChannels(messages(language).providersSettings)}
                inputClassName="rounded-xl py-2.5 ring-accent focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <p className="text-xs text-fg-muted">{o.step2SecurityNote}</p>
            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => dispatch({ type: 'patch', patch: { step: 'provider' } })}>
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
                onSelectedChange={(id) => dispatch({ type: 'patch', patch: { selectedModelId: id } })}
              />
            )}
            {error && models.length > 0 ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => dispatch({ type: 'patch', patch: { step: 'apiKey' } })}>
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
