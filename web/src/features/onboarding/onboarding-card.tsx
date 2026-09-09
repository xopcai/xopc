import { ChevronRight, ExternalLink, Mail, ShieldCheck, X } from 'lucide-react';
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
  bootstrapUserModel,
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

type OnboardingStep = 'callName' | 'understanding' | 'provider' | 'apiKey';

type OnboardingState = {
  step: OnboardingStep;
  selectedProvider: string | null;
  apiKey: string;
  busy: boolean;
  error: string | null;
  callName: string;
  role: string;
  responsibilities: string;
  goals: string;
  boundaries: string;
  relationships: string;
  communicationPreferences: string[];
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
  role: '',
  responsibilities: '',
  goals: '',
  boundaries: '',
  relationships: '',
  communicationPreferences: [],
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

const STEP_ORDER: OnboardingStep[] = ['callName', 'understanding', 'provider', 'apiKey'];

const COMMUNICATION_OPTIONS = [
  { value: 'Lead with the conclusion', zh: '结论优先', en: 'Lead with the conclusion' },
  { value: 'Challenge weak assumptions', zh: '直接指出问题', en: 'Challenge weak assumptions' },
  { value: 'Proactively advance work and share progress', zh: '主动推进并同步进展', en: 'Proactively advance work' },
  { value: 'Keep responses concise unless detail is requested', zh: '默认简洁，需要时再展开', en: 'Concise unless detail is needed' },
] as const;

function lines(value: string): string[] {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

const stepNumber = (step: OnboardingStep): number => STEP_ORDER.indexOf(step) + 1;

export function OnboardingCard({ onComplete, onDismiss, canDismiss = true }: OnboardingCardProps) {
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  const o = messages(language).onboarding;

  const [state, dispatch] = useReducer(onboardingReducer, initialOnboarding);
  const {
    step, selectedProvider, apiKey, busy, error, callName, role, responsibilities,
    goals, boundaries, relationships, communicationPreferences, profileLoading,
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
          if (profile.role.trim()) dispatch({ type: 'patch', patch: { role: profile.role } });
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
        locale: language === 'zh' ? 'zh-CN' : 'en-US',
      });
      dispatch({ type: 'patch', patch: { step: 'understanding' } });
    } catch (cause) {
      dispatch({
        type: 'patch',
        patch: { error: cause instanceof Error ? cause.message : String(cause) },
      });
    } finally {
      dispatch({ type: 'patch', patch: { busy: false } });
    }
  };

  const continueFromUnderstanding = async () => {
    dispatch({ type: 'patch', patch: { busy: true, error: null } });
    try {
      await bootstrapUserModel({
        profile: {
          ...(callName.trim() ? { callName: callName.trim() } : {}),
          ...(role.trim() ? { role: role.trim() } : {}),
          timezone: detectBrowserTimezone(),
          locale: language === 'zh' ? 'zh-CN' : 'en-US',
        },
        responsibilities: lines(responsibilities),
        goals: lines(goals),
        communicationPreferences,
        boundaries: lines(boundaries),
        relationships: lines(relationships),
      });
      dispatch({ type: 'patch', patch: { step: 'provider' } });
    } catch (cause) {
      dispatch({ type: 'patch', patch: { error: cause instanceof Error ? cause.message : String(cause) } });
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
          <div className="xopc-onboarding-orbit relative flex size-72 items-center justify-center" aria-hidden>
            <span className="xopc-onboarding-orbit-glow absolute inset-[14%] rounded-full" />
            <span className="xopc-onboarding-orbit-ring xopc-onboarding-orbit-ring--outer absolute inset-0 rounded-full" />
            <span className="xopc-onboarding-orbit-ring xopc-onboarding-orbit-ring--middle absolute inset-[17%] rounded-full" />
            <span className="xopc-onboarding-orbit-ring xopc-onboarding-orbit-ring--inner absolute inset-[31%] rounded-full" />
            <span className="xopc-onboarding-orbit-sweep absolute inset-[8%] rounded-full" />
            <span className="xopc-onboarding-orbit-satellite xopc-onboarding-orbit-satellite--one absolute inset-[8%] rounded-full"><i /></span>
            <span className="xopc-onboarding-orbit-satellite xopc-onboarding-orbit-satellite--two absolute inset-[24%] rounded-full"><i /></span>
            <span className="xopc-onboarding-orbit-particles absolute inset-0">
              <i /><i /><i /><i /><i /><i />
            </span>
            <span className="xopc-onboarding-orbit-core relative flex size-24 items-center justify-center rounded-full">
              <BrandLogo className="size-12 lg:size-14" />
            </span>
          </div>
        </section>

        <section className="flex min-h-[30rem] items-center overflow-y-auto border-t border-edge-subtle bg-surface-panel/80 px-5 py-10 backdrop-blur-2xl sm:px-10 lg:min-h-0 lg:border-l lg:border-t-0 lg:px-[clamp(3rem,6vw,7rem)]">
          <div className="xopc-onboarding-stage w-full max-w-[36rem]" key={step}>
            {step === 'callName' ? (
              <div>
                <p className="text-sm font-medium text-accent-fg">{language === 'zh' ? '先认识彼此' : 'First, let’s meet'}</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-fg sm:text-4xl">{o.step0Title}</h1>
                <p className="mt-3 text-sm leading-7 text-fg-muted">{o.step0Subtitle}</p>
                <label className="mt-10 block">
                  <span className="sr-only">{o.profileCallNameLabel}</span>
                  {profileLoading ? <Skeleton className="h-24 w-full rounded-3xl" /> : (
                    <span className="xopc-onboarding-name-envelope group relative flex min-h-24 w-full items-center gap-4 overflow-hidden rounded-3xl border border-edge bg-surface-panel px-5 py-4 shadow-surface">
                      <span className="xopc-onboarding-name-envelope-fold pointer-events-none absolute inset-0" aria-hidden />
                      <span className="xopc-onboarding-name-envelope-icon relative z-10 flex size-11 shrink-0 items-center justify-center rounded-2xl border border-edge bg-surface-panel text-accent-fg shadow-surface" aria-hidden>
                        <Mail className="size-5" strokeWidth={1.6} />
                      </span>
                      <span className="relative z-10 min-w-0 flex-1">
                        <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-fg-subtle">
                          {o.profileCallNameLabel}
                        </span>
                        <input
                          autoFocus
                          autoComplete="name"
                          value={callName}
                          onChange={(event) => dispatch({ type: 'patch', patch: { callName: event.target.value } })}
                          onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void continueFromCallName(); }}
                          placeholder={o.profileCallNamePlaceholder}
                          className="mt-1.5 h-8 w-full bg-transparent text-lg font-medium tracking-[-0.01em] text-fg outline-none placeholder:font-normal placeholder:text-fg-subtle"
                        />
                      </span>
                      <span className="xopc-onboarding-name-envelope-seal relative z-10 hidden size-9 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent-soft sm:flex" aria-hidden>
                        <span className="size-2 rounded-full bg-accent shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_12%,transparent)]" />
                      </span>
                    </span>
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

            {step === 'understanding' ? (
              <div>
                <p className="text-sm font-medium text-accent-fg">{language === 'zh' ? '建立初始理解' : 'Build initial understanding'}</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-fg sm:text-4xl">
                  {language === 'zh' ? '告诉我怎样更好地与你协作' : 'Tell me how to work well with you'}
                </h1>
                <p className="mt-3 text-sm leading-7 text-fg-muted">
                  {language === 'zh' ? '这些内容会立即生效。每行写一项；有偏差时，在后续对话中直接纠正即可。' : 'These become active immediately. Add one item per line; correct me naturally whenever something is off.'}
                </p>
                <div className="mt-7 grid gap-4 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-fg-muted">
                    {language === 'zh' ? '你的角色' : 'Your role'}
                    <input value={role} onChange={(event) => dispatch({ type: 'patch', patch: { role: event.target.value } })} placeholder={language === 'zh' ? '例如：创始人、产品负责人' : 'e.g. Founder, product lead'} className="mt-1.5 h-10 w-full rounded-xl border border-edge bg-surface-base px-3 text-sm text-fg outline-none focus:border-accent" />
                  </label>
                  <label className="block text-xs font-medium text-fg-muted">
                    {language === 'zh' ? '主要职责（每行一项）' : 'Responsibilities (one per line)'}
                    <textarea value={responsibilities} onChange={(event) => dispatch({ type: 'patch', patch: { responsibilities: event.target.value } })} placeholder={language === 'zh' ? '产品方向\n招聘核心成员' : 'Product direction\nHiring key roles'} rows={2} className="mt-1.5 w-full resize-none rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
                  </label>
                  <label className="block text-xs font-medium text-fg-muted sm:col-span-2">
                    {language === 'zh' ? '当前目标（每行一项，第一项作为当前首要目标）' : 'Current goals (one per line; the first is primary)'}
                    <textarea value={goals} onChange={(event) => dispatch({ type: 'patch', patch: { goals: event.target.value } })} placeholder={language === 'zh' ? '本月完成产品内测' : 'Ship the private beta this month'} rows={2} className="mt-1.5 w-full resize-none rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
                  </label>
                  <fieldset className="sm:col-span-2">
                    <legend className="text-xs font-medium text-fg-muted">{language === 'zh' ? '沟通与协作偏好' : 'Communication preferences'}</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {COMMUNICATION_OPTIONS.map((option) => {
                        const selected = communicationPreferences.includes(option.value);
                        return <button key={option.value} type="button" aria-pressed={selected} onClick={() => dispatch({ type: 'patch', patch: { communicationPreferences: selected ? communicationPreferences.filter((value) => value !== option.value) : [...communicationPreferences, option.value] } })} className={cn('rounded-full border px-3 py-1.5 text-xs transition-colors', selected ? 'border-accent bg-accent-soft text-accent-fg' : 'border-edge bg-surface-base text-fg-muted hover:text-fg')}>{language === 'zh' ? option.zh : option.en}</button>;
                      })}
                    </div>
                  </fieldset>
                  <label className="block text-xs font-medium text-fg-muted">
                    {language === 'zh' ? '边界（每行一项）' : 'Boundaries (one per line)'}
                    <textarea value={boundaries} onChange={(event) => dispatch({ type: 'patch', patch: { boundaries: event.target.value } })} placeholder={language === 'zh' ? '对外发送内容前必须确认' : 'Ask before sending anything externally'} rows={2} className="mt-1.5 w-full resize-none rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
                  </label>
                  <label className="block text-xs font-medium text-fg-muted">
                    {language === 'zh' ? '重要关系（每行一项）' : 'Important relationships (one per line)'}
                    <textarea value={relationships} onChange={(event) => dispatch({ type: 'patch', patch: { relationships: event.target.value } })} placeholder={language === 'zh' ? 'Alice 是合伙人，产品决策需同步她' : 'Alice is my cofounder; include her in product decisions'} rows={2} className="mt-1.5 w-full resize-none rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
                  </label>
                </div>
                {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
                <div className="mt-7 flex items-center justify-between gap-3">
                  <Button variant="ghost" onClick={() => dispatch({ type: 'patch', patch: { step: 'callName', error: null } })}>{o.back}</Button>
                  <Button className="h-11 bg-accent px-5 text-white hover:bg-accent-hover" disabled={busy} onClick={() => void continueFromUnderstanding()}>
                    {busy ? o.savingProfile : o.continue}<ChevronRight className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 'provider' ? (
              <div>
                <p className="text-sm font-medium text-accent-fg">{language === 'zh' ? '配置智能模型' : 'Configure intelligence'}</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-fg sm:text-4xl">{language === 'zh' ? '选择模型服务' : 'Choose an AI service'}</h1>
                <p className="mt-3 text-sm leading-7 text-fg-muted">
                  {callName.trim()
                    ? (language === 'zh' ? `${callName.trim()}，选择一个服务，我们会为你配置推荐模型。你可以稍后在设置中进行调整。` : `${callName.trim()}, choose a service and we’ll configure its recommended model. You can adjust it later in Settings.`)
                    : o.step1Subtitle}
                </p>
                <div className="mt-8">
                  <OnboardingProviderGrid
                    onSelect={(id) => dispatch({ type: 'patch', patch: { selectedProvider: id, step: 'apiKey', apiKey: '', error: null } })}
                  />
                </div>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                  <Button variant="ghost" onClick={() => dispatch({ type: 'patch', patch: { step: 'understanding', error: null } })}>{o.back}</Button>
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
