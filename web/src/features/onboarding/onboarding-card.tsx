import type { ModelSetupPreview } from '@xopcai/gateway-contract';

import { CheckCircle2, ChevronRight, LoaderCircle, X } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { Loopi } from '@/components/brand/loopi';
import { Button } from '@/components/ui/button';
import { OnboardingLanguageSwitch } from '@/features/onboarding/onboarding-language-switch';
import { OnboardingProviderGrid } from '@/features/onboarding/onboarding-provider-grid';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { OAuthProviderConnect } from '@/features/settings/models-hub/oauth-provider-connect';
import { applyModelSetup, previewModelSetup } from '@/features/settings/models-hub/provider-setup-api';
import { AddProviderDialog } from '@/features/settings/models-hub/add-provider-dialog';
import { useConnectedProviders } from '@/features/settings/models-hub/connected-providers-grid';
import {
  detectBrowserTimezone,
  fetchUserProfile,
  updateUserProfile,
} from '@/features/user-model/user-model-api';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

interface OnboardingCardProps {
  onComplete: () => void | Promise<void>;
  onDismiss: () => void;
  canDismiss?: boolean;
  onPendingChange?: (pending: boolean) => void;
}

type OnboardingStep = 'callName' | 'provider' | 'success';

type OnboardingState = {
  step: OnboardingStep;
  selectedProvider: string | null;
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

const STEP_ORDER: OnboardingStep[] = ['callName', 'provider', 'success'];

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

export function OnboardingCard({ onComplete, onDismiss, canDismiss = true, onPendingChange }: OnboardingCardProps) {
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  const o = messages(language).onboarding;

  const [state, dispatch] = useReducer(onboardingReducer, initialOnboarding);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const providerData = useConnectedProviders();
  const desktop = isElectron();
  const applyingCloud = useRef(false);
  const [cloudAuthorized, setCloudAuthorized] = useState(false);
  const [cloudSetup, setCloudSetup] = useState<ModelSetupPreview | null>(null);
  const cloudConnected = cloudAuthorized || providerData.cards.some(provider => provider.id === 'xopc-cloud' && provider.configured);
  const {
    step, selectedProvider, busy, error, callName,
  } = state;

  useEffect(() => { onPendingChange?.(busy); return () => onPendingChange?.(false); }, [busy, onPendingChange]);

  const stepLabel = useMemo(
    () => o.stepOf.replace('{{current}}', String(stepNumber(step))).replace('{{total}}', String(STEP_ORDER.length)),
    [o.stepOf, step],
  );

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

  const finishCloudSetup = async () => {
    if (applyingCloud.current) return;
    applyingCloud.current = true;
    dispatch({ type: 'patch', patch: { busy: true, error: null } });
    try {
      const request = { mode: 'replace' as const };
      const preview = await previewModelSetup('xopc-cloud', request);
      if (!preview.configured || !preview.uses.find(use => use.id === 'chat')?.recommended) {
        throw new Error(language === 'zh' ? 'XOPC Cloud 尚未就绪，请稍后重试。' : 'XOPC Cloud is not ready yet. Please retry.');
      }
      const selected = preview.uses.filter(use => use.selected && use.recommended).map(use => use.id);
      await applyModelSetup('xopc-cloud', { ...request, selected }, preview.revision);
      setCloudSetup(preview);
      dispatch({ type: 'patch', patch: { step: 'success' } });
    } catch (cause) {
      dispatch({ type: 'patch', patch: { error: cause instanceof Error ? cause.message : String(cause) } });
    } finally {
      applyingCloud.current = false;
      dispatch({ type: 'patch', patch: { busy: false } });
    }
  };

  const completeOnboarding = async () => {
    dispatch({ type: 'patch', patch: { busy: true, error: null } });
    try { await onComplete(); }
    catch (cause) { dispatch({ type: 'patch', patch: { error: cause instanceof Error ? cause.message : String(cause) } }); }
    finally { dispatch({ type: 'patch', patch: { busy: false } }); }
  };

  return (
    <div className="xopc-onboarding-experience relative flex h-full min-h-0 w-full flex-col overflow-hidden" data-step={step}>
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
              disabled={busy}
              className="inline-flex size-10 items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={onDismiss}
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      <main className="xopc-onboarding-scroll relative z-10 grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(18rem,0.8fr)_minmax(30rem,1.2fr)]">
        <section className="xopc-onboarding-visual relative hidden min-h-0 items-center justify-center overflow-hidden lg:flex">
          <Loopi className="size-72 text-fg-muted" interactive language={language} mood={error ? 'care' : busy ? 'work' : step === 'success' ? 'done' : step === 'callName' ? 'listen' : 'decision'} />
        </section>

        <section className="app-main-surface xopc-onboarding-scroll flex min-h-[30rem] items-center overflow-y-auto bg-surface-panel px-5 py-8 sm:px-10 lg:min-h-0 lg:px-[clamp(3rem,6vw,6rem)]">
          <div className="xopc-onboarding-stage w-full max-w-[30rem]" key={step}>
            <div className="mb-3 lg:hidden"><Loopi className="size-20" mood={error ? 'care' : busy ? 'work' : step === 'success' ? 'done' : 'listen'} /></div>
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
                  <Button variant="primary" className="h-11 justify-self-end px-5" disabled={busy} onClick={() => void continueFromCallName()}>
                    {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                    {busy ? o.savingProfile : o.continue}
                    {!busy ? <ChevronRight className="size-4" aria-hidden /> : null}
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 'provider' ? (
              <div className="flex min-h-[30rem] flex-col">
                <p className="text-xs font-medium tracking-wide text-accent-fg">{desktop ? 'XOPC Cloud' : language === 'zh' ? '模型设置' : 'Model setup'}</p>
                <h1 className="mt-3 text-[2rem] font-semibold leading-tight tracking-[-0.035em] text-fg sm:text-4xl">{desktop ? (language === 'zh' ? '连接 XOPC Cloud' : 'Connect XOPC Cloud') : o.step1Title}</h1>
                <p className="mt-3 max-w-md text-sm leading-6 text-fg-muted">{desktop ? (language === 'zh' ? '登录后自动配置聊天、图片、语音和任务模型，开启可用能力。电脑操作默认关闭，无需 API Key。' : 'Sign in to set up chat, image, voice, and task models and enable available capabilities. Computer control stays off by default. No API key required.') : o.step1Subtitle}</p>
                <div className="mt-8">
                  {desktop ? <fieldset disabled={busy} className="min-w-0"><OAuthProviderConnect providerId="xopc-cloud" displayName="XOPC Cloud" connected={cloudConnected} onConnected={() => { setCloudAuthorized(true); void finishCloudSetup(); }} /></fieldset> : <OnboardingProviderGrid
                    onSelect={(id) => {
                      dispatch({ type: 'patch', patch: { selectedProvider: id, error: null } });
                      setProviderDialogOpen(true);
                    }}
                    onBrowseProviders={() => { dispatch({ type: 'patch', patch: { selectedProvider: null } }); setProviderDialogOpen(true); }}
                    disabled={busy}
                    browseDisabled={providerData.loading}
                  />}
                </div>
                <div className="mt-3 min-h-5">{error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}</div>
                <div className="mt-auto grid grid-cols-[1fr_auto_1fr] items-center gap-3 pt-8">
                  <Button variant="ghost" className="justify-self-start" disabled={busy} onClick={() => dispatch({ type: 'patch', patch: { step: 'callName', error: null } })}>{o.back}</Button>
                  <OnboardingProgress step={step} label={stepLabel} />
                  {desktop && cloudConnected ? <Button variant="primary" className="h-11 justify-self-end px-5" disabled={busy} onClick={() => void finishCloudSetup()}>{busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}{error ? (language === 'zh' ? '重试' : 'Retry') : o.continue}</Button> : <span />}
                </div>
              </div>
            ) : null}

            {step === 'success' ? (
              <div className="flex min-h-[30rem] flex-col">
                <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-6" aria-hidden />
                </span>
                <p className="mt-6 text-xs font-medium tracking-wide text-accent-fg">
                  {language === 'zh' ? '模型设置完成' : 'Model setup complete'}
                </p>
                <h1 className="mt-3 text-[2rem] font-semibold leading-tight tracking-[-0.035em] text-fg sm:text-4xl">
                  {language === 'zh' ? '一切准备好了' : 'You’re ready to go'}
                </h1>
                <p className="mt-3 max-w-md text-sm leading-6 text-fg-muted">
                  {cloudSetup
                    ? (language === 'zh' ? '已配置并开启账号可用的模型能力，电脑操作默认关闭。' : 'Available model capabilities are configured and enabled. Computer control stays off by default.')
                    : (language === 'zh' ? '模型服务配置已保存，可以开始对话。' : 'Model service settings are saved. You can start a conversation.')}
                  {cloudSetup?.uses.some(use => !use.selected) ? (language === 'zh' ? ' 部分能力暂无可用模型，可稍后在模型设置中查看。' : ' Some capabilities have no available model. Review them in Model settings.') : null}
                </p>
                <div className="mt-3 min-h-5">{error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}</div>
                <div className="mt-auto grid grid-cols-[1fr_auto_1fr] items-center gap-3 pt-10">
                  <span />
                  <OnboardingProgress step={step} label={stepLabel} />
                  <Button variant="primary" className="h-11 justify-self-end px-5" disabled={busy} onClick={() => void completeOnboarding()}>
                    {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                    {language === 'zh' ? '开始使用 XOPC' : 'Start using XOPC'}
                    {!busy ? <ChevronRight className="size-4" aria-hidden /> : null}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </main>
      {!desktop ? <AddProviderDialog
        open={providerDialogOpen}
        initialProviderId={selectedProvider ?? undefined}
        onOpenChange={setProviderDialogOpen}
        builtinRows={providerData.builtinRows}
        customConfig={providerData.customConfig}
        labels={messages(language).capabilitiesSettings.addProviderDialog}
        language={language}
        onSaved={(providerId) => {
          if (providerId === 'xopc-cloud') {
            setProviderDialogOpen(false);
            void finishCloudSetup();
            return;
          }
          void updateUserProfile({ ...(callName.trim() ? { callName: callName.trim() } : {}), timezone: detectBrowserTimezone(), locale: language === 'zh' ? 'zh-CN' : 'en-US' })
            .then(() => { setProviderDialogOpen(false); dispatch({ type: 'patch', patch: { step: 'success', error: null } }); })
            .catch(cause => dispatch({ type: 'patch', patch: { error: cause instanceof Error ? cause.message : String(cause) } }));
        }}
      /> : null}
    </div>
  );
}
