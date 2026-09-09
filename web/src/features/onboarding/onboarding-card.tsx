import { ChevronRight, ExternalLink, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { Link } from 'react-router-dom';

import { BrandLogo } from '@/components/shell/brand-logo';
import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
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
} from '@/features/user-model/user-model-api';
import { fetchGlobalDefaults, updateGlobalDefaults } from '@/features/settings/global-defaults-api';
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

function OnboardingProgress({ step, label }: { step: OnboardingStep; label: string }) {
  const current = stepNumber(step) - 1;
  return (
    <div className="flex items-center gap-1.5" aria-label={label}>
      {STEP_ORDER.map((item, index) => (
        <span
          key={item}
          className={cn(
            'h-1.5 rounded-full transition-[width,background-color] duration-200 motion-reduce:transition-none',
            index === current ? 'w-5 bg-accent' : 'w-1.5',
            index < current ? 'bg-accent/45' : index > current ? 'bg-edge-strong' : undefined,
          )}
          aria-hidden
        />
      ))}
    </div>
  );
}

export function OnboardingCard({ onComplete, onDismiss, canDismiss = true }: OnboardingCardProps) {
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  const o = messages(language).onboarding;

  const [state, dispatch] = useReducer(onboardingReducer, initialOnboarding);
  const {
    step, selectedProvider, apiKey, busy, error, callName,
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
          return;
        } catch {
          if (attempt < 2) {
            await new Promise<void>((resolve) => {
              retryTimer = setTimeout(resolve, 250 * (attempt + 1));
            });
          }
        }
      }
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
        ...(normalizedCallName ? { callName: normalizedCallName } : {}),
        timezone: detectBrowserTimezone(),
        locale: language === 'zh' ? 'zh-CN' : 'en-US',
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
    const updatedDefaults = await updateGlobalDefaults({
      ...defaults.defaults,
      models: {
        ...defaults.defaults.models,
        chat: { primary: modelRef, fallbacks: [] },
      },
    });
    if (updatedDefaults.defaults.models.chat.primary !== modelRef) {
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
      locale: language === 'zh' ? 'zh-CN' : 'en-US',
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
      <header className="relative z-20 flex h-18 shrink-0 items-center justify-end px-5 sm:px-8 lg:px-10">
        <div className="flex items-center gap-2">
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

      <main className="relative z-10 grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(18rem,0.8fr)_minmax(30rem,1.2fr)]">
        <section className="xopc-onboarding-visual relative hidden min-h-0 items-center justify-center overflow-hidden lg:flex">
          <div className="xopc-onboarding-mark relative flex size-64 items-center justify-center" aria-hidden>
            <span className="xopc-onboarding-mark-halo absolute inset-[10%] rounded-full" />
            <span className="xopc-onboarding-mark-trace absolute inset-[13%] rounded-full" />
            <span className="xopc-onboarding-mark-core relative flex size-36 items-center justify-center">
              <BrandLogo className="relative z-10 size-28 lg:size-32" />
            </span>
          </div>
        </section>

        <section className="flex min-h-[30rem] items-center overflow-y-auto border-t border-edge-subtle bg-surface-panel/45 px-5 py-8 sm:px-10 lg:min-h-0 lg:border-l lg:border-t-0 lg:px-[clamp(3rem,6vw,6rem)]">
          <div className="xopc-onboarding-stage w-full max-w-[30rem]" key={step}>
            {step === 'callName' ? (
              <div className="flex min-h-[30rem] flex-col">
                <p className="text-xs font-medium tracking-wide text-accent-fg">{o.title}</p>
                <h1 className="mt-3 text-[2rem] font-semibold leading-tight tracking-[-0.035em] text-fg sm:text-4xl">{o.step0Title}</h1>
                <p className="mt-3 max-w-md text-sm leading-6 text-fg-muted">{o.step0Subtitle}</p>
                <label className="mt-9 block">
                  <span className="mb-2 flex items-center justify-between text-[13px] font-medium text-fg-muted">
                    <span>{o.profileCallNameLabel}</span>
                    <span className="font-normal text-fg-subtle">{language === 'zh' ? '可选' : 'Optional'}</span>
                  </span>
                  <input
                    autoFocus
                    autoComplete="name"
                    value={callName}
                    onChange={(event) => dispatch({ type: 'patch', patch: { callName: event.target.value } })}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void continueFromCallName(); }}
                    placeholder={o.profileCallNamePlaceholder}
                    className="h-12 w-full rounded-xl border border-edge bg-surface-base/80 px-3.5 text-[15px] text-fg outline-none transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-fg-subtle hover:border-edge-strong focus:border-accent focus:bg-surface-base focus:ring-4 focus:ring-accent/10 motion-reduce:transition-none"
                  />
                </label>
                <div className="mt-3 min-h-5">{error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}</div>
                <div className="mt-auto grid grid-cols-[1fr_auto_1fr] items-center gap-3 pt-10">
                  <span />
                  <OnboardingProgress step={step} label={stepLabel} />
                  <Button className="h-11 justify-self-end bg-accent px-5 text-white hover:bg-accent-hover" disabled={busy} onClick={() => void continueFromCallName()}>
                    {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                    {busy ? o.savingProfile : o.continue}
                    {!busy ? <ChevronRight className="size-4" aria-hidden /> : null}
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 'provider' ? (
              <div className="flex min-h-[30rem] flex-col">
                <p className="text-xs font-medium tracking-wide text-accent-fg">{language === 'zh' ? '模型设置' : 'Model setup'}</p>
                <h1 className="mt-3 text-[2rem] font-semibold leading-tight tracking-[-0.035em] text-fg sm:text-4xl">{o.step1Title}</h1>
                <p className="mt-3 max-w-md text-sm leading-6 text-fg-muted">{o.step1Subtitle}</p>
                <div className="mt-8">
                  <OnboardingProviderGrid
                    onSelect={(id) => dispatch({ type: 'patch', patch: { selectedProvider: id, step: 'apiKey', apiKey: '', error: null } })}
                  />
                </div>
                <div className="mt-auto grid grid-cols-[1fr_auto_1fr] items-center gap-3 pt-8">
                  <Button variant="ghost" className="justify-self-start" onClick={() => dispatch({ type: 'patch', patch: { step: 'callName', error: null } })}>{o.back}</Button>
                  <OnboardingProgress step={step} label={stepLabel} />
                  <Link to="/settings/capabilities/models" className="justify-self-end text-right text-xs font-medium text-fg-muted hover:text-accent-fg hover:underline">
                    {language === 'zh' ? '打开高级模型设置' : 'Open advanced model settings'}
                  </Link>
                </div>
              </div>
            ) : null}

            {step === 'apiKey' ? (
              <div className="flex min-h-[30rem] flex-col">
                <p className="text-xs font-medium tracking-wide text-accent-fg">{o.step2Title}</p>
                <h1 className="mt-3 text-[2rem] font-semibold leading-tight tracking-[-0.035em] text-fg sm:text-4xl">
                  {selectedProvider === 'xopc-cloud'
                    ? (language === 'zh' ? '连接 XOPC Cloud' : 'Connect XOPC Cloud')
                    : (language === 'zh' ? `连接 ${selectedProvider ?? ''}` : `Connect ${selectedProvider ?? ''}`)}
                </h1>
                <p className="mt-3 max-w-md text-sm leading-6 text-fg-muted">
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
                          inputClassName="h-12 rounded-xl bg-surface-base/80 px-3.5 text-[15px] ring-accent focus:border-accent focus:ring-4 focus:ring-accent/10"
                        />
                      </label>
                      <div className="mt-4 flex items-center gap-2 text-xs leading-5 text-fg-muted"><ShieldCheck className="size-4 text-accent-fg" />{o.step2SecurityNote.replace('🔒 ', '')}</div>
                    </>
                  )}
                </div>
                {busy && selectedProvider === 'xopc-cloud' ? <p className="mt-4 text-sm text-fg-muted">{language === 'zh' ? '正在应用推荐模型…' : 'Applying the recommended model…'}</p> : null}
                <div className="mt-3 min-h-5">{error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}</div>
                <div className="mt-auto grid grid-cols-[1fr_auto_1fr] items-center gap-3 pt-10">
                  <Button variant="ghost" className="justify-self-start" disabled={busy} onClick={() => dispatch({ type: 'patch', patch: { step: 'provider', error: null } })}>{o.back}</Button>
                  <OnboardingProgress step={step} label={stepLabel} />
                  {selectedProvider !== 'xopc-cloud' ? (
                    <Button className="h-11 justify-self-end bg-accent px-5 text-white hover:bg-accent-hover" disabled={busy || !apiKey.trim()} onClick={() => void onContinueApiKey()}>
                      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                      {o.continue}
                      {!busy ? <ChevronRight className="size-4" aria-hidden /> : null}
                    </Button>
                  ) : <span />}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
