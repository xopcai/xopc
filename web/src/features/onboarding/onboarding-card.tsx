import { ExternalLink, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { Link } from 'react-router-dom';

import { BrandLogo } from '@/components/shell/brand-logo';
import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { Skeleton } from '@/components/ui/skeleton';
import type { ConfiguredModel } from '@/features/chat/api/registry-api';
import { fetchConfiguredModelsCached, invalidateConfiguredModelsCache } from '@/features/chat/api/registry-api';
import { dispatchConfigReload } from '@/features/gateway/dispatch-config-reload';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { OnboardingLanguageSwitch } from '@/features/onboarding/onboarding-language-switch';
import { OnboardingProviderGrid } from '@/features/onboarding/onboarding-provider-grid';
import { OAuthProviderConnect } from '@/features/settings/models-hub/oauth-provider-connect';
import { buildProviderConfigFromPresetProviderId } from '@/features/settings/models/models-settings-lib';
import { fetchModelsJson, saveModelsJson } from '@/features/settings/models-json-api';
import { detectBrowserTimezone, fetchUserProfile, updateUserProfile } from '@/features/user-context/user-context-api';
import { fetchGlobalDefaults, updateGlobalDefaultModels } from '@/features/settings/global-defaults-api';
import { PROVIDER_ENRICHMENT } from '@/features/settings/provider-enrichment';
import { patchProviderApiKeys } from '@/features/settings/providers-api';
import { messages } from '@/i18n/messages';
import { secretInputLabelsFromChannels } from '@/lib/secret-input-labels';
import { useLocaleStore } from '@/stores/locale-store';

interface OnboardingCardProps {
  onComplete: () => void | Promise<void>;
  onDismiss: () => void;
  canDismiss?: boolean;
}

type OnboardingStep = 'callName' | 'provider' | 'apiKey';

type OnboardingState = {
  step: OnboardingStep;
  selectedProvider: string | null;
  apiKey: string;
  busy: boolean;
  error: string | null;
  callName: string;
  profileLoading: boolean;
};

type OnboardingAction =
  | { type: 'patch'; patch: Partial<OnboardingState> }
  | { type: 'prefillCallName'; value: string };

const initialOnboarding: OnboardingState = {
  step: 'callName',
  selectedProvider: null,
  apiKey: '',
  busy: false,
  error: null,
  callName: '',
  profileLoading: true,
};

function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };
    case 'prefillCallName':
      return state.callName.trim() ? state : { ...state, callName: action.value };
  }
}

const STEP_ORDER: OnboardingStep[] = ['callName', 'provider', 'apiKey'];

const stepNumber = (step: OnboardingStep): number => STEP_ORDER.indexOf(step) + 1;

export function OnboardingCard({ onComplete, onDismiss, canDismiss = true }: OnboardingCardProps) {
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  const o = messages(language).onboarding;

  const [state, dispatch] = useReducer(onboardingReducer, initialOnboarding);
  const { step, selectedProvider, apiKey, busy, error, callName, profileLoading } = state;

  const stepLabel = useMemo(
    () => o.stepOf.replace('{{current}}', String(stepNumber(step))).replace('{{total}}', '3'),
    [o.stepOf, step],
  );

  const resolveRecommendedModel = useCallback(async (providerId: string): Promise<ConfiguredModel | null> => {
    dispatch({ type: 'patch', patch: { error: null } });
    try {
      const list = await fetchConfiguredModelsCached(true);
      const filtered = list
        .filter((model) => model.provider === providerId)
        .sort((a, b) => {
          if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
          return (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' });
        });
      return filtered[0] ?? null;
    } catch (cause) {
      dispatch({
        type: 'patch',
        patch: {
          error: cause instanceof Error ? cause.message : String(cause),
        },
      });
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const defaults = await fetchGlobalDefaults();
        const recommendation = defaults.recommendations[0];
        if (!recommendation || cancelled) return;
        // Keep the first step visible; the recommendation is used when the user continues.
        dispatch({ type: 'patch', patch: { selectedProvider: recommendation.provider } });
      } catch {
        /* keep the manual provider step */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const { profile, suggestedCallName } = await fetchUserProfile();
          if (cancelled) return;
          const prefill = profile.callName.trim() || suggestedCallName?.trim();
          if (prefill) {
            dispatch({ type: 'prefillCallName', value: prefill });
          }
          dispatch({ type: 'patch', patch: { profileLoading: false } });
          return;
        } catch {
          if (attempt < 2) {
            await new Promise<void>((resolve) => {
              retryTimer = setTimeout(resolve, 250 * (attempt + 1));
            });
          }
        }
      }
      if (!cancelled) dispatch({ type: 'patch', patch: { profileLoading: false } });
    })();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, []);

  const continueFromCallName = async () => {
    const normalizedCallName = callName.trim();
    if (!normalizedCallName) {
      dispatch({ type: 'patch', patch: { step: 'provider', error: null } });
      return;
    }
    dispatch({ type: 'patch', patch: { busy: true, error: null } });
    try {
      await updateUserProfile({
        callName: normalizedCallName,
        timezone: detectBrowserTimezone(),
      });
      dispatch({ type: 'patch', patch: { step: 'provider' } });
    } catch (cause) {
      dispatch({
        type: 'patch',
        patch: { error: cause instanceof Error ? cause.message : String(cause) },
      });
    } finally {
      dispatch({ type: 'patch', patch: { busy: false } });
    }
  };

  const finishSetup = useCallback(async (modelRef: string) => {
    await updateGlobalDefaultModels({
      defaultRole: 'deep',
      roles: {
        deep: { model: modelRef },
      },
    });
    void revalidateGatewayConfig();
    void invalidateConfiguredModelsCache();
    dispatchConfigReload();

    await updateUserProfile({
      ...(callName.trim() ? { callName: callName.trim() } : {}),
      timezone: detectBrowserTimezone(),
    });
    await onComplete();
  }, [callName, onComplete]);

  const onContinueApiKey = async () => {
    if (!selectedProvider || !apiKey.trim()) return;
    dispatch({ type: 'patch', patch: { busy: true, error: null } });
    try {
      const presetProvider = buildProviderConfigFromPresetProviderId(selectedProvider, apiKey.trim());
      if (presetProvider) {
        const status = await fetchModelsJson();
        const existingProvider = status.config.providers[presetProvider.providerId] ?? {};
        await saveModelsJson({
          ...status.config,
          providers: {
            ...status.config.providers,
            [presetProvider.providerId]: {
              ...existingProvider,
              ...presetProvider.config,
            },
          },
        });
      } else {
        await patchProviderApiKeys({ [selectedProvider]: apiKey.trim() });
      }
      const recommendedModel = await resolveRecommendedModel(selectedProvider);
      if (!recommendedModel) {
        throw new Error(language === 'zh'
          ? '没有找到可用模型，请检查密钥或前往“模型与服务”进行高级配置。'
          : 'No available model was found. Check the key or open Models & services for advanced setup.');
      }
      await finishSetup(recommendedModel.id);
    } catch (cause) {
      dispatch({ type: 'patch', patch: { error: cause instanceof Error ? cause.message : String(cause) } });
    } finally {
      dispatch({ type: 'patch', patch: { busy: false } });
    }
  };

  const finishXopcCloudSetup = async () => {
    dispatch({ type: 'patch', patch: { busy: true, error: null } });
    try {
      const recommendedModel = await resolveRecommendedModel('xopc-cloud');
      if (!recommendedModel) {
        throw new Error(language === 'zh'
          ? 'XOPC Cloud 已连接，但没有找到可用模型，请稍后重试。'
          : 'XOPC Cloud connected, but no available model was found. Try again shortly.');
      }
      await finishSetup(recommendedModel.id);
    } catch (cause) {
      dispatch({
        type: 'patch',
        patch: { error: cause instanceof Error ? cause.message : String(cause) },
      });
    } finally {
      dispatch({ type: 'patch', patch: { busy: false } });
    }
  };

  return (
    <div className="relative w-full max-w-xl rounded-2xl border border-edge bg-surface-panel p-6 shadow-elevated">
      <div className="-mr-3 -mt-3 flex min-h-11 items-start justify-end gap-1">
        <OnboardingLanguageSwitch
          value={language}
          onChange={(nextLanguage) => {
            dispatch({ type: 'patch', patch: { error: null } });
            setLanguage(nextLanguage);
          }}
        />
        {canDismiss ? (
          <button
            type="button"
            aria-label={o.skipSetup}
            className="inline-flex size-11 items-center justify-center rounded-xl text-fg-muted transition hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={onDismiss}
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="mt-1 text-center">
        <BrandLogo className="mx-auto size-11" />
        <h2 className="mt-3 text-lg font-semibold tracking-tight text-fg">{o.title}</h2>
        <p className="mt-1 text-sm text-fg-muted">{o.subtitle}</p>
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-fg-muted">{stepLabel}</p>
      </div>

      <div className="mt-6">
        {step === 'callName' ? (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-base font-medium text-fg">{o.step0Title}</h3>
              <p className="mt-1 text-sm text-fg-muted">{o.step0Subtitle}</p>
            </div>
            <label className="block text-sm font-medium text-fg">
              {o.profileCallNameLabel}
              {profileLoading ? <Skeleton className="mt-1 h-10 w-full rounded-xl" /> : (
                <input
                  autoFocus
                  value={callName}
                  onChange={(event) => dispatch({ type: 'patch', patch: { callName: event.target.value } })}
                  placeholder={o.profileCallNamePlaceholder}
                  className="mt-1 w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
              )}
            </label>
            <div className="flex flex-wrap justify-between gap-2">
              <button
                type="button"
                className="text-xs font-medium text-fg-muted hover:text-fg hover:underline"
                disabled={busy || profileLoading}
                onClick={() => void continueFromCallName()}
              >
                {o.skipCallName}
              </button>
              <Button
                type="button"
                className="bg-accent text-white hover:bg-accent/90"
                disabled={busy || profileLoading}
                onClick={() => void continueFromCallName()}
              >
                {busy ? o.savingProfile : o.continue}
              </Button>
            </div>
            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          </div>
        ) : null}

        {step === 'provider' ? (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-base font-medium text-fg">{o.step1Title}</h3>
              {callName.trim() ? (
                <p className="mt-1 text-sm text-fg-muted">
                  {language === 'zh' ? `好的 ${callName}，${o.step1Subtitle}` : `Great, ${callName}! ${o.step1Subtitle}`}
                </p>
              ) : (
                <p className="mt-1 text-sm text-fg-muted">{o.step1Subtitle}</p>
              )}
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
              <Link to="/settings/capabilities/models" className="text-xs font-medium text-accent-fg hover:underline">
                {language === 'zh' ? '配置其他模型…' : 'Configure other models…'}
              </Link>
              {canDismiss ? (
                <button
                  type="button"
                  className="text-xs font-medium text-fg-muted hover:text-fg hover:underline"
                  onClick={onDismiss}
                >
                  {o.skipSetup}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === 'apiKey' ? (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-base font-medium text-fg">
                {selectedProvider === 'xopc-cloud'
                  ? (language === 'zh' ? '连接 XOPC Cloud' : 'Connect XOPC Cloud')
                  : `${o.step2Title}${selectedProvider ? ` (${selectedProvider})` : ''}`}
              </h3>
              <p className="mt-1 text-sm text-fg-muted">
                {selectedProvider === 'xopc-cloud'
                  ? (language === 'zh'
                      ? '登录 XOPC Console 并授权，模型会自动同步，无需填写 API Key。'
                      : 'Sign in to XOPC Console to sync your models. No API key is required.')
                  : o.step2Subtitle}
              </p>
            </div>
            {selectedProvider === 'xopc-cloud' ? (
              <OAuthProviderConnect
                providerId="xopc-cloud"
                displayName="XOPC Model Service"
                connected={false}
                onConnected={() => void finishXopcCloudSetup()}
              />
            ) : (
              <>
                {selectedProvider && (() => {
                  const enrichment = PROVIDER_ENRICHMENT[selectedProvider];
                  const apiKeyUrl = enrichment?.apiKeyUrl;
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
                        {language === 'zh' ? '前往获取' : 'Get API Key'}
                        <ExternalLink className="size-3" />
                      </a>
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
              </>
            )}
            {busy && selectedProvider === 'xopc-cloud' ? (
              <p className="text-sm text-fg-muted">
                {language === 'zh' ? '正在应用推荐模型…' : 'Applying the recommended model…'}
              </p>
            ) : null}
            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => dispatch({ type: 'patch', patch: { step: 'provider' } })}>
                {o.back}
              </Button>
              {selectedProvider !== 'xopc-cloud' ? (
                <Button
                  type="button"
                  className="bg-accent text-white hover:bg-accent/90"
                  disabled={busy || !apiKey.trim()}
                  onClick={() => void onContinueApiKey()}
                >
                  {busy ? o.continue : o.startChatting}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

      </div>
    </div>
  );
}
