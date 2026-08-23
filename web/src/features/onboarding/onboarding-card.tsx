import { Check, ChevronRight, ExternalLink, ListChecks, MessageSquareText, Rocket, ShieldCheck, Sparkles, X, type LucideIcon } from 'lucide-react';
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
  createCollaborationRule,
  detectBrowserTimezone,
  fetchUserContext,
  fetchUserProfile,
  updateCollaborationRule,
  updateUserProfile,
} from '@/features/user-context/user-context-api';
import { fetchGlobalDefaults, updateGlobalDefaultModels } from '@/features/settings/global-defaults-api';
import { fetchImageCatalog, type ImageProvider } from '@/features/settings/image-generation-api';
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

export function resolveXopcCloudImageDefaults(
  models: ConfiguredModel[],
  imageProviders: ImageProvider[],
): { imageModel?: { primary: string }; imageGenerationModel?: { primary: string } } {
  const vision = models.find((model) => model.provider === 'xopc-cloud' && model.vision === true);
  const generation = imageProviders.find((provider) =>
    provider.id === 'xopc-cloud' && provider.configured && provider.models.length > 0);
  const generationModel = generation?.models.includes(generation.defaultModel)
    ? generation.defaultModel
    : generation?.models[0];
  return {
    ...(vision ? { imageModel: { primary: vision.id } } : {}),
    ...(generationModel ? { imageGenerationModel: { primary: `xopc-cloud/${generationModel}` } } : {}),
  };
}

type OnboardingStep = 'callName' | 'collaboration' | 'provider' | 'apiKey';
type ExecutionMode = 'act' | 'plan' | 'confirm';
type OutputMode = 'concise' | 'balanced' | 'detailed';

type OnboardingState = {
  step: OnboardingStep;
  selectedProvider: string | null;
  apiKey: string;
  busy: boolean;
  error: string | null;
  callName: string;
  role: string;
  primaryGoal: string;
  executionMode: ExecutionMode;
  outputMode: OutputMode;
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
  primaryGoal: '',
  executionMode: 'act',
  outputMode: 'balanced',
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

const STEP_ORDER: OnboardingStep[] = ['callName', 'collaboration', 'provider', 'apiKey'];

const stepNumber = (step: OnboardingStep): number => STEP_ORDER.indexOf(step) + 1;

function ChoiceGroup({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Array<{ value: string; title: string; hint: string; icon: LucideIcon }>;
  onChange: (value: string) => void;
}) {
  const selectedHint = options.find((option) => option.value === value)?.hint;

  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-fg-muted">{label}</legend>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const selected = option.value === value;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={cn(
                'group relative flex min-h-18 items-center gap-2.5 rounded-xl border p-3 text-left transition-[transform,border-color,background-color,box-shadow] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]',
                'hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transform-none motion-reduce:transition-none',
                selected
                  ? 'border-accent/60 bg-accent-soft/75 shadow-surface'
                  : 'border-edge bg-surface-base/60 hover:border-edge-strong hover:bg-surface-panel',
              )}
              onClick={() => onChange(option.value)}
            >
              <span className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                selected ? 'bg-accent text-white' : 'bg-surface-muted text-fg-muted group-hover:text-fg',
              )}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="block pr-5 text-sm font-semibold text-fg">{option.title}</span>
              <span className={cn(
                'absolute right-2.5 top-2.5 flex size-5 items-center justify-center rounded-full border transition-all',
                selected ? 'scale-100 border-accent bg-accent text-white' : 'scale-90 border-edge-strong bg-transparent text-transparent',
              )}>
                <Check className="size-3" strokeWidth={2.5} aria-hidden />
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 min-h-5 text-xs leading-5 text-fg-muted">{selectedHint}</p>
    </fieldset>
  );
}

export function OnboardingCard({ onComplete, onDismiss, canDismiss = true }: OnboardingCardProps) {
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  const o = messages(language).onboarding;

  const [state, dispatch] = useReducer(onboardingReducer, initialOnboarding);
  const {
    step, selectedProvider, apiKey, busy, error, callName, role, primaryGoal,
    executionMode, outputMode, profileLoading,
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
          dispatch({ type: 'patch', patch: { role: profile.role, primaryGoal: profile.primaryGoal } });
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
        role: role.trim(),
        primaryGoal: primaryGoal.trim(),
        timezone: detectBrowserTimezone(),
      });
      dispatch({ type: 'patch', patch: { step: 'collaboration' } });
    } catch (cause) {
      dispatch({
        type: 'patch',
        patch: { error: cause instanceof Error ? cause.message : String(cause) },
      });
    } finally {
      dispatch({ type: 'patch', patch: { busy: false } });
    }
  };

  const saveCollaborationDefaults = async () => {
    const statements = language === 'zh'
      ? {
          execution: executionMode === 'act'
            ? '任务明确时直接推进并汇报结果；外部、不可逆或高风险操作前再确认。'
            : executionMode === 'plan'
              ? '任务明确时先给出简洁方案，再开始执行。'
              : '执行重要动作前先向我确认。',
          output: outputMode === 'concise'
            ? '默认先给结论，只保留完成当前任务所需的必要信息。'
            : outputMode === 'balanced'
              ? '默认给出结论、核心理由和有用的下一步信息。'
              : '默认提供完整背景、关键权衡和验证过程。',
        }
      : {
          execution: executionMode === 'act'
            ? 'When the task is clear, move it forward and report the result; pause before external, irreversible, or high-risk actions.'
            : executionMode === 'plan'
              ? 'When the task is clear, show a concise approach before taking action.'
              : 'Ask me before taking meaningful action.',
          output: outputMode === 'concise'
            ? 'Lead with the outcome and include only the details needed for the current task.'
            : outputMode === 'balanced'
              ? 'Default to the outcome, core reasoning, and the next useful detail.'
              : 'Default to complete context, key tradeoffs, and verification.',
        };

    dispatch({ type: 'patch', patch: { busy: true, error: null } });
    try {
      const current = await fetchUserContext();
      const saveRule = async (
        onboardingKey: 'execution_mode' | 'output_mode',
        statement: string,
        category: 'execution' | 'communication',
      ) => {
        const existing = current.rules.find((rule) => rule.conditions.onboardingKey === onboardingKey);
        if (existing) {
          await updateCollaborationRule(existing.id, { statement, status: 'active' });
          return;
        }
        await createCollaborationRule({
          statement,
          category,
          priority: 20,
          conditions: { onboardingKey },
        });
      };
      await Promise.all([
        saveRule('execution_mode', statements.execution, 'execution'),
        saveRule('output_mode', statements.output, 'communication'),
      ]);
      dispatch({ type: 'patch', patch: { step: 'provider' } });
    } catch (cause) {
      dispatch({ type: 'patch', patch: { error: cause instanceof Error ? cause.message : String(cause) } });
    } finally {
      dispatch({ type: 'patch', patch: { busy: false } });
    }
  };

  const finishSetup = useCallback(async (modelRef: string, providerId: string) => {
    const defaults = await fetchGlobalDefaults();
    const cloudImageDefaults = providerId === 'xopc-cloud'
      ? resolveXopcCloudImageDefaults(
          await fetchConfiguredModelsCached(true),
          await fetchImageCatalog(),
        )
      : {};
    await updateGlobalDefaultModels({
      ...defaults.models,
      defaultRole: 'deep',
      roles: {
        ...defaults.models.roles,
        deep: { model: modelRef },
      },
      ...(!defaults.models.imageModel && cloudImageDefaults.imageModel
        ? { imageModel: cloudImageDefaults.imageModel }
        : {}),
      ...(!defaults.models.imageGenerationModel && cloudImageDefaults.imageGenerationModel
        ? { imageGenerationModel: cloudImageDefaults.imageGenerationModel }
        : {}),
    });
    void revalidateGatewayConfig();
    void invalidateConfiguredModelsCache();
    dispatchConfigReload();

    await updateUserProfile({
      ...(callName.trim() ? { callName: callName.trim() } : {}),
      role: role.trim(),
      primaryGoal: primaryGoal.trim(),
      timezone: detectBrowserTimezone(),
    });
    await onComplete();
  }, [callName, onComplete, primaryGoal, role]);

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
      await finishSetup(recommendedModel.id, selectedProvider);
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
      await finishSetup(recommendedModel.id, 'xopc-cloud');
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
    <div className="xopc-onboarding-card relative flex h-full w-full flex-col overflow-hidden rounded-[1.75rem] border border-white/60 bg-surface-panel/95 p-5 shadow-float backdrop-blur-2xl dark:border-white/10">
      <div className="xopc-onboarding-aurora pointer-events-none absolute inset-x-0 -top-48 h-80" aria-hidden />
      <header className="relative z-10 grid min-h-13 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-edge-subtle pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="xopc-onboarding-logo flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/70 bg-white/80 shadow-surface dark:border-white/10 dark:bg-white/5">
            <BrandLogo className="size-7" />
          </div>
          <h2 className="hidden truncate text-sm font-semibold tracking-[-0.015em] text-fg sm:block">{o.title}</h2>
        </div>
        <div className="w-28 sm:w-56" aria-label={stepLabel}>
          <div className="flex items-center gap-1.5">
            {STEP_ORDER.map((item, index) => (
              <span
                key={item}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-[background-color,transform] duration-500 motion-reduce:transition-none',
                  index < stepNumber(step) ? 'scale-y-110 bg-accent' : 'bg-edge-strong/70',
                )}
                aria-hidden
              />
            ))}
          </div>
          <p className="mt-1.5 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-fg-subtle">{stepLabel}</p>
        </div>
        <div className="flex items-center justify-end gap-1">
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
              className="inline-flex size-10 items-center justify-center rounded-xl text-fg-muted transition hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={onDismiss}
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      <div className="xopc-onboarding-content relative z-10 min-h-0 flex-1 overflow-hidden pt-4">
        {step === 'callName' ? (
          <div className="xopc-onboarding-stage mx-auto flex h-full max-w-2xl flex-col gap-4">
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-fg">{o.step0Title}</h3>
              <p className="mt-1 text-sm text-fg-muted">{o.step0Subtitle}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
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
              <label className="block text-sm font-medium text-fg">
                {o.profileRoleLabel}
                <input
                  value={role}
                  onChange={(event) => dispatch({ type: 'patch', patch: { role: event.target.value } })}
                  placeholder={o.profileRolePlaceholder}
                  maxLength={300}
                  className="mt-1 w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
              </label>
            </div>
            <label className="block text-sm font-medium text-fg">
              {o.profileGoalLabel}
              <textarea
                value={primaryGoal}
                onChange={(event) => dispatch({ type: 'patch', patch: { primaryGoal: event.target.value } })}
                placeholder={o.profileGoalPlaceholder}
                maxLength={500}
                rows={2}
                className="mt-1 w-full resize-none rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <div className="min-h-5">
              {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            </div>
            <div className="mt-auto flex flex-wrap justify-between gap-2 border-t border-edge-subtle pt-4">
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
          </div>
        ) : null}

        {step === 'collaboration' ? (
          <div className="xopc-onboarding-stage mx-auto flex h-full max-w-3xl flex-col gap-3">
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-fg">{o.collaborationTitle}</h3>
              <p className="mt-1 text-sm text-fg-muted">{o.collaborationSubtitle}</p>
            </div>

            <ChoiceGroup
              label={o.executionLabel}
              value={executionMode}
              onChange={(value) => dispatch({ type: 'patch', patch: { executionMode: value as ExecutionMode } })}
              options={[
                { value: 'act', title: o.executionAct, hint: o.executionActHint, icon: Rocket },
                { value: 'plan', title: o.executionPlan, hint: o.executionPlanHint, icon: ListChecks },
                { value: 'confirm', title: o.executionConfirm, hint: o.executionConfirmHint, icon: ShieldCheck },
              ]}
            />
            <ChoiceGroup
              label={o.outputLabel}
              value={outputMode}
              onChange={(value) => dispatch({ type: 'patch', patch: { outputMode: value as OutputMode } })}
              options={[
                { value: 'concise', title: o.outputConcise, hint: o.outputConciseHint, icon: MessageSquareText },
                { value: 'balanced', title: o.outputBalanced, hint: o.outputBalancedHint, icon: Sparkles },
                { value: 'detailed', title: o.outputDetailed, hint: o.outputDetailedHint, icon: ListChecks },
              ]}
            />
            <div className="min-h-5">
              {error ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            </div>
            <div className="mt-auto flex items-center justify-between gap-3 border-t border-edge-subtle pt-4">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => dispatch({ type: 'patch', patch: { step: 'callName', error: null } })}>
                {o.back}
              </Button>
              <Button
                type="button"
                className="min-w-32 bg-accent text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-accent-hover motion-reduce:transform-none"
                disabled={busy}
                onClick={() => void saveCollaborationDefaults()}
              >
                {busy ? o.savingCollaboration : <>{o.continue}<ChevronRight className="ml-1 size-4" aria-hidden /></>}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'provider' ? (
          <div className="xopc-onboarding-stage mx-auto flex h-full max-w-4xl flex-col gap-4">
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-fg">{o.step1Title}</h3>
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
            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-edge-subtle pt-4">
              <Button type="button" variant="secondary" onClick={() => dispatch({ type: 'patch', patch: { step: 'collaboration', error: null } })}>
                {o.back}
              </Button>
              <div className="flex flex-wrap items-center justify-end gap-4">
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
          </div>
        ) : null}

        {step === 'apiKey' ? (
          <div className="xopc-onboarding-stage mx-auto flex h-full max-w-2xl flex-col gap-4">
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-fg">
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
            <div className="min-h-5">
              {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            </div>
            <div className="mt-auto flex flex-wrap justify-between gap-2 border-t border-edge-subtle pt-4">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => dispatch({ type: 'patch', patch: { step: 'provider', error: null } })}>
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
