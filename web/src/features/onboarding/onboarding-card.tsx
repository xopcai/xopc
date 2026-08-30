import { ChevronRight, ExternalLink, ShieldCheck, X } from 'lucide-react';
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
import { cn } from '@/lib/cn';
import { OAuthProviderConnect } from '@/features/settings/models-hub/oauth-provider-connect';
import { buildProviderConfigFromPresetProviderId } from '@/features/settings/models/models-settings-lib';
import { fetchModelsJson, saveModelsJson } from '@/features/settings/models-json-api';
import {
  detectBrowserTimezone,
  fetchUserProfile,
  updateUserProfile,
} from '@/features/user-context/user-context-api';
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
  const {
    step, selectedProvider, apiKey, busy, error, callName, profileLoading,
  } = state;

  const stepLabel = useMemo(
    () => o.stepOf.replace('{{current}}', String(stepNumber(step))).replace('{{total}}', String(STEP_ORDER.length)),
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
    const defaults = await fetchGlobalDefaults();
    const updatedDefaults = await updateGlobalDefaultModels({
      ...defaults.models,
      defaultRole: 'deep',
      roles: {
        ...defaults.models.roles,
        deep: { model: modelRef },
      },
    });
    const configuredRole = updatedDefaults.models.defaultRole;
    if (updatedDefaults.models.roles[configuredRole]?.model !== modelRef) {
      throw new Error(language === 'zh'
        ? '默认模型未能保存，请重试。'
        : 'The default model could not be saved. Try again.');
    }
    void revalidateGatewayConfig();
    void invalidateConfiguredModelsCache();
    dispatchConfigReload();

    await updateUserProfile({
      ...(callName.trim() ? { callName: callName.trim() } : {}),
      timezone: detectBrowserTimezone(),
    });
    await onComplete();
  }, [callName, language, onComplete]);

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
    <div className="xopc-onboarding-experience relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-base" data-step={step}>
      <div className="xopc-onboarding-ambient pointer-events-none absolute inset-0" aria-hidden />
      <header className="relative z-20 flex h-18 shrink-0 items-center justify-between px-5 sm:px-8 lg:px-10">
        <div className="flex items-center gap-3">
          <BrandLogo className="size-8" />
          <span className="text-sm font-semibold tracking-[-0.02em] text-fg">xopc</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="mr-2 hidden items-center gap-1.5 sm:flex" aria-label={stepLabel}>
            {STEP_ORDER.map((item, index) => (
              <span
                key={item}
                className={cn(
                  'h-1.5 w-5 rounded-full transition-[transform,background-color,opacity] duration-500 motion-reduce:transition-none',
                  index === stepNumber(step) - 1 ? 'scale-x-100 bg-accent' : index < stepNumber(step) ? 'scale-x-[.35] bg-accent/45' : 'scale-x-[.35] bg-edge-strong',
                )}
                aria-hidden
              />
            ))}
          </div>
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
              className="inline-flex size-10 items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={onDismiss}
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      <main className="relative z-10 grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(16rem,0.65fr)_minmax(32rem,1.35fr)]">
        <section className="xopc-onboarding-visual relative hidden min-h-0 items-center justify-center overflow-hidden lg:flex">
          <div className="xopc-onboarding-orbit relative flex size-40 items-center justify-center" aria-hidden>
            <span className="xopc-onboarding-orbit-ring absolute inset-0 rounded-full border border-accent/15" />
            <span className="xopc-onboarding-orbit-ring xopc-onboarding-orbit-ring--inner absolute inset-[18%] rounded-full border border-edge" />
            <BrandLogo className="size-10 lg:size-12" />
          </div>
        </section>

        <section className="flex min-h-[30rem] items-center border-t border-edge-subtle bg-surface-panel/80 px-5 py-10 backdrop-blur-2xl sm:px-10 lg:min-h-0 lg:border-l lg:border-t-0 lg:px-[clamp(3rem,6vw,7rem)]">
          <div className="xopc-onboarding-stage w-full max-w-[36rem]" key={step}>
            {step === 'callName' ? (
              <div>
                <p className="text-sm font-medium text-accent-fg">{language === 'zh' ? '先认识彼此' : 'First, let’s meet'}</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-fg sm:text-4xl">{o.step0Title}</h1>
                <p className="mt-3 text-sm leading-7 text-fg-muted">{o.step0Subtitle}</p>
                <label className="mt-10 block">
                  <span className="sr-only">{o.profileCallNameLabel}</span>
                  {profileLoading ? <Skeleton className="h-14 w-full rounded-2xl" /> : (
                    <input
                      autoFocus
                      autoComplete="name"
                      value={callName}
                      onChange={(event) => dispatch({ type: 'patch', patch: { callName: event.target.value } })}
                      onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void continueFromCallName(); }}
                      placeholder={o.profileCallNamePlaceholder}
                      className="h-14 w-full rounded-2xl border border-edge bg-surface-panel px-4 text-lg text-fg shadow-surface outline-none transition-[border-color,box-shadow] placeholder:text-fg-subtle focus:border-accent focus:ring-4 focus:ring-accent/10"
                    />
                  )}
                </label>
                {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
                <div className="mt-10 flex items-center justify-end gap-3">
                  <Button className="h-11 bg-accent px-5 text-white hover:bg-accent-hover" disabled={busy || profileLoading} onClick={() => void continueFromCallName()}>
                    {busy ? o.savingProfile : o.continue}<ChevronRight className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 'provider' ? (
              <div>
                <p className="text-sm font-medium text-accent-fg">{language === 'zh' ? '接通智能' : 'Connect intelligence'}</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-fg sm:text-4xl">{language === 'zh' ? '选择能力来源' : 'Choose how xopc is powered'}</h1>
                <p className="mt-3 text-sm leading-7 text-fg-muted">
                  {callName.trim()
                    ? (language === 'zh' ? `${callName.trim()}，我们会自动使用推荐模型，高级选项可以稍后调整。` : `${callName.trim()}, we’ll apply the recommended model and leave advanced choices for later.`)
                    : o.step1Subtitle}
                </p>
                <div className="mt-8">
                  <OnboardingProviderGrid
                    onSelect={(id) => dispatch({ type: 'patch', patch: { selectedProvider: id, step: 'apiKey', apiKey: '', error: null } })}
                  />
                </div>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                  <Button variant="ghost" onClick={() => dispatch({ type: 'patch', patch: { step: 'callName', error: null } })}>{o.back}</Button>
                  <Link to="/settings/capabilities/models" className="text-xs font-medium text-fg-muted hover:text-accent-fg hover:underline">
                    {language === 'zh' ? '打开高级模型设置' : 'Open advanced model settings'}
                  </Link>
                </div>
              </div>
            ) : null}

            {step === 'apiKey' ? (
              <div>
                <p className="text-sm font-medium text-accent-fg">{language === 'zh' ? '最后一步' : 'One last step'}</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-fg sm:text-4xl">
                  {selectedProvider === 'xopc-cloud'
                    ? (language === 'zh' ? '连接 XOPC Cloud' : 'Connect XOPC Cloud')
                    : (language === 'zh' ? `连接 ${selectedProvider ?? ''}` : `Connect ${selectedProvider ?? ''}`)}
                </h1>
                <p className="mt-3 text-sm leading-7 text-fg-muted">
                  {selectedProvider === 'xopc-cloud'
                    ? (language === 'zh' ? '登录后会自动同步可用模型，不需要填写 API Key。' : 'Sign in to sync available models automatically. No API key is required.')
                    : o.step2Subtitle}
                </p>
                <div className="mt-9">
                  {selectedProvider === 'xopc-cloud' ? (
                    <OAuthProviderConnect providerId="xopc-cloud" displayName="XOPC Model Service" connected={false} onConnected={() => void finishXopcCloudSetup()} />
                  ) : (
                    <>
                      {selectedProvider && PROVIDER_ENRICHMENT[selectedProvider]?.apiKeyUrl ? (
                        <a href={PROVIDER_ENRICHMENT[selectedProvider].apiKeyUrl} target="_blank" rel="noopener noreferrer" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent-fg hover:underline">
                          {language === 'zh' ? '获取 API Key' : 'Get an API key'}<ExternalLink className="size-3.5" />
                        </a>
                      ) : null}
                      <label className="block">
                        <span className="sr-only">{o.step2Placeholder}</span>
                        <SecretInput
                          value={apiKey}
                          onChange={(next) => dispatch({ type: 'patch', patch: { apiKey: next } })}
                          placeholder={o.step2Placeholder}
                          labels={secretInputLabelsFromChannels(messages(language).providersSettings)}
                          inputClassName="h-14 rounded-2xl bg-surface-panel px-4 text-base ring-accent focus:border-accent focus:ring-4 focus:ring-accent/10"
                        />
                      </label>
                      <div className="mt-4 flex items-center gap-2 text-xs leading-5 text-fg-muted"><ShieldCheck className="size-4 text-accent-fg" />{o.step2SecurityNote.replace('🔒 ', '')}</div>
                    </>
                  )}
                </div>
                {busy && selectedProvider === 'xopc-cloud' ? <p className="mt-4 text-sm text-fg-muted">{language === 'zh' ? '正在应用推荐模型…' : 'Applying the recommended model…'}</p> : null}
                {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
                <div className="mt-10 flex items-center justify-between gap-3">
                  <Button variant="ghost" disabled={busy} onClick={() => dispatch({ type: 'patch', patch: { step: 'provider', error: null } })}>{o.back}</Button>
                  {selectedProvider !== 'xopc-cloud' ? (
                    <Button className="h-11 bg-accent px-5 text-white hover:bg-accent-hover" disabled={busy || !apiKey.trim()} onClick={() => void onContinueApiKey()}>
                      {busy ? o.continue : (language === 'zh' ? '接入我的工作' : 'Connect my work')}<ChevronRight className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
