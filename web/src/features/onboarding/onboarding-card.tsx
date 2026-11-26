import type { ModelSetupPreview } from '@xopcai/gateway-contract';

import { Check, CheckCircle2, ChevronRight, LoaderCircle, Pencil } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { ExternalRuntimeAvatar } from '@/components/brand/external-runtime-avatar';
import { externalRuntimeLabel } from '@/components/brand/external-runtime-badge';
import { Loopi } from '@/components/brand/loopi';
import { APP_CHROME_BAR_CLASS, APP_CHROME_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import {
  ensureDefaultPersonalAgent,
  prefetchDesktopOnboardingContext,
  prefetchExternalRuntimesFast,
} from '@/features/onboarding/desktop-onboarding-bootstrap';
import type { ExternalRuntimeFastDetection } from '@/features/settings/types/agent-gateway';
import { OnboardingLanguageSwitch } from '@/features/onboarding/onboarding-language-switch';
import { OnboardingProviderGrid } from '@/features/onboarding/onboarding-provider-grid';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { isElectronDarwin, isElectronWin32 } from '@/lib/electron-window-chrome';
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
  const [editingName, setEditingName] = useState(false);
  const [desktopApplied, setDesktopApplied] = useState(false);
  const providerData = useConnectedProviders();
  const desktop = isElectron();
  const applyingCloud = useRef(false);
  const [cloudAuthorized, setCloudAuthorized] = useState(false);
  const [cloudSetup, setCloudSetup] = useState<ModelSetupPreview | null>(null);
  const [detectedRuntimes, setDetectedRuntimes] = useState<ExternalRuntimeFastDetection[]>([]);
  const cloudConnected = cloudAuthorized || providerData.cards.some(provider => provider.id === 'xopc-cloud' && provider.configured);
  const {
    step, selectedProvider, busy, error, callName,
  } = state;

  useEffect(() => { onPendingChange?.(busy); return () => onPendingChange?.(false); }, [busy, onPendingChange]);

  useEffect(() => {
    let cancelled = false;
    void prefetchExternalRuntimesFast().then((items) => {
      if (!cancelled) setDetectedRuntimes(items.filter((entry) => entry.installed));
    });
    return () => { cancelled = true; };
  }, []);

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

  const persistProfileSilently = async () => {
    const normalizedCallName = callName.trim();
    try {
      await updateUserProfile({
        ...(normalizedCallName ? { callName: normalizedCallName } : {}),
        timezone: detectBrowserTimezone(),
        locale: language === 'zh' ? 'zh-CN' : 'en-US',
      });
    } catch {
      // Optional profile defaults must never block first-run setup on desktop.
    }
  };

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
    } catch {
      dispatch({
        type: 'patch',
        patch: { error: language === 'zh' ? '称呼暂未保存，可重试或稍后设置并继续连接模型。若登录已失效，请先重新连接本机服务。' : 'Your name was not saved. Retry or set it later and continue to model setup. Reconnect the service if your sign-in has expired.' },
      });
    } finally {
      dispatch({ type: 'patch', patch: { busy: false } });
    }
  };

  const completeDesktopSilently = async () => {
    await persistProfileSilently();
    void ensureDefaultPersonalAgent();
    void prefetchDesktopOnboardingContext();
    await onComplete();
  };

  const finishCloudSetup = async () => {
    if (applyingCloud.current) return;
    applyingCloud.current = true;
    dispatch({ type: 'patch', patch: { busy: true, error: null } });
    try {
      if (desktop && desktopApplied) {
        await completeDesktopSilently();
        return;
      }
      const request = { mode: 'replace' as const };
      const preview = await previewModelSetup('xopc-cloud', request);
      if (!preview.configured || !preview.uses.find(use => use.id === 'chat')?.recommended) {
        throw new Error(language === 'zh' ? 'XOPC Cloud 尚未就绪，请稍后重试。' : 'XOPC Cloud is not ready yet. Please retry.');
      }
      const selected = preview.uses.filter(use => use.selected && use.recommended).map(use => use.id);
      await applyModelSetup('xopc-cloud', { ...request, selected }, preview.revision);
      setCloudSetup(preview);
      if (desktop) {
        setDesktopApplied(true);
        await completeDesktopSilently();
        return;
      }
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

  const skipButton = canDismiss ? (
    <Button variant="ghost" disabled={busy} onClick={onDismiss}>{o.skipSetup}</Button>
  ) : null;

  if (desktop) {
    const zh = language === 'zh';
    const trimmedName = callName.trim();
    return (
      <div className="xopc-onboarding-experience relative flex h-full min-h-0 w-full flex-col overflow-hidden" data-step="desktop-connect">
        <header className={cn(
          'relative z-20 flex h-14 shrink-0 items-center justify-end gap-2 px-5 sm:px-8',
          isElectronDarwin() && `${APP_CHROME_BAR_CLASS} ${APP_CHROME_DRAG_CLASS} pl-[88px]`,
          isElectronWin32() && `${APP_CHROME_BAR_CLASS} ${APP_CHROME_DRAG_CLASS} pr-[144px]`,
        )}>
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <OnboardingLanguageSwitch
              value={language}
              onChange={(nextLanguage) => {
                dispatch({ type: 'patch', patch: { error: null } });
                setLanguage(nextLanguage);
              }}
            />
          </div>
        </header>

        <main className="xopc-onboarding-scroll relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 pb-12 pt-2 sm:px-8">
          <div className="xopc-focus-stage flex w-full max-w-[30rem] flex-col items-center text-center">
            <Loopi
              className="mb-6 size-28"
              interactive
              language={language}
              mood={error ? 'care' : busy ? 'work' : desktopApplied ? 'done' : 'listen'}
            />

            {/* Inline optional call-name pill (prefilled from OS, editable in place, zero extra step) */}
            <div className="mb-3 min-h-8">
              {editingName ? (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-accent bg-surface-panel px-3 py-1 shadow-surface">
                  <input
                    autoFocus
                    autoComplete="name"
                    aria-label={o.profileCallNameLabel}
                    value={callName}
                    onChange={(event) => dispatch({ type: 'patch', patch: { callName: event.target.value } })}
                    onBlur={() => setEditingName(false)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        setEditingName(false);
                      }
                    }}
                    placeholder={o.profileCallNamePlaceholder}
                    className="w-36 bg-transparent text-center text-xs font-medium text-fg outline-none placeholder:text-fg-subtle"
                  />
                  <button
                    type="button"
                    aria-label={zh ? '完成编辑称呼' : 'Done editing name'}
                    className="text-accent-fg hover:text-fg"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setEditingName(false)}
                  >
                    <Check className="size-3.5" aria-hidden />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditingName(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-panel/85 px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:border-edge-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span>
                    {trimmedName
                      ? (zh ? `你好，${trimmedName}` : `Hi, ${trimmedName}`)
                      : (zh ? '设置你的称呼' : 'Set your name')}
                  </span>
                  <Pencil className="size-3 opacity-70" aria-hidden />
                </button>
              )}
            </div>

            <h1 className="text-[1.875rem] font-semibold leading-tight tracking-[-0.035em] text-fg sm:text-[2.25rem]">
              {zh ? '配置模型' : 'Set up models'}
            </h1>
            <p className="mt-2.5 max-w-[24rem] text-sm leading-6 text-fg-muted">
              {zh
                ? '连接即可使用，电脑操作默认关闭。'
                : 'Ready once connected. Computer control stays off.'}
            </p>

            <div className="mt-8 w-full text-left">
              <fieldset disabled={busy} className="min-w-0">
                <OAuthProviderConnect
                  providerId="xopc-cloud"
                  displayName="XOPC Cloud"
                  connected={cloudConnected}
                  showIdleDescription={false}
                  secondaryAction={cloudConnected ? undefined : skipButton}
                  onConnected={() => {
                    setCloudAuthorized(true);
                    void finishCloudSetup();
                  }}
                />
              </fieldset>

              {cloudConnected ? (
                <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                  {skipButton}
                  <Button
                    type="button"
                    variant="primary"
                    className="h-10 gap-1.5 rounded-xl px-5"
                    disabled={busy}
                    onClick={() => void finishCloudSetup()}
                  >
                    {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                    {error ? (zh ? '重试' : 'Retry') : o.continue}
                    {!busy && !error ? <ChevronRight className="size-4" aria-hidden /> : null}
                  </Button>
                </div>
              ) : null}

              {error ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
              {cloudSetup?.uses.some(use => !use.selected) ? (
                <p className="mt-2.5 text-xs text-fg-muted">
                  {zh ? '部分能力暂无可用模型，可稍后在模型设置中查看。' : 'Some capabilities have no available model. Review them in Model settings.'}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                dispatch({ type: 'patch', patch: { selectedProvider: null, error: null } });
                setProviderDialogOpen(true);
              }}
              className="mt-6 text-xs font-medium text-fg-muted transition-colors hover:text-fg hover:underline"
            >
              {zh ? '使用 API Key 或本地模型' : 'Use an API key or local model'}
            </button>

            {detectedRuntimes.length > 0 ? (
              <div
                data-onboarding-detected-runtimes-hint
                className="mt-5 inline-flex max-w-full items-center gap-2 rounded-full border border-edge bg-surface-panel/75 px-3.5 py-1.5 text-xs text-fg-muted"
              >
                <span className="flex shrink-0 items-center -space-x-1">
                  {detectedRuntimes.map((entry) => (
                    <ExternalRuntimeAvatar key={entry.kind} kind={entry.kind} size={16} />
                  ))}
                </span>
                <span className="truncate">
                  {zh
                    ? `已检测到本机 ${detectedRuntimes.map((entry) => externalRuntimeLabel(entry.kind, 'short')).join('、')}，下一步可一键接入`
                    : `Detected ${detectedRuntimes.map((entry) => externalRuntimeLabel(entry.kind, 'short')).join(', ')} — connect in the next step`}
                </span>
              </div>
            ) : null}
          </div>
        </main>

        <AddProviderDialog
          open={providerDialogOpen}
          initialProviderId={selectedProvider ?? undefined}
          onOpenChange={setProviderDialogOpen}
          builtinRows={providerData.builtinRows}
          customConfig={providerData.customConfig}
          labels={messages(language).capabilitiesSettings.addProviderDialog}
          language={language}
          onSaved={(providerId) => {
            setProviderDialogOpen(false);
            if (providerId === 'xopc-cloud') {
              void finishCloudSetup();
              return;
            }
            dispatch({ type: 'patch', patch: { busy: true, error: null } });
            void completeDesktopSilently()
              .catch((cause) => {
                dispatch({ type: 'patch', patch: { error: cause instanceof Error ? cause.message : String(cause) } });
              })
              .finally(() => {
                dispatch({ type: 'patch', patch: { busy: false } });
              });
          }}
        />
      </div>
    );
  }

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
                <Button variant="ghost" className="self-start" disabled={busy} onClick={() => dispatch({ type: 'patch', patch: { step: 'provider', error: null } })}>
                  {language === 'zh' ? '稍后设置称呼' : 'Set name later'}
                </Button>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-10">
                  <OnboardingProgress step={step} label={stepLabel} />
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    {skipButton}
                    <Button variant="primary" className="h-11 px-5" disabled={busy} onClick={() => void continueFromCallName()}>
                      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                      {busy ? o.savingProfile : o.continue}
                      {!busy ? <ChevronRight className="size-4" aria-hidden /> : null}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 'provider' ? (
              <div className="flex min-h-[30rem] flex-col">
                <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.035em] text-fg sm:text-4xl">{o.step1Title}</h1>
                <p className="mt-3 max-w-md text-sm leading-6 text-fg-muted">{o.step1Subtitle}</p>
                <div className="mt-8">
                  <OnboardingProviderGrid
                    onSelect={(id) => {
                      dispatch({ type: 'patch', patch: { selectedProvider: id, error: null } });
                      setProviderDialogOpen(true);
                    }}
                    onBrowseProviders={() => { dispatch({ type: 'patch', patch: { selectedProvider: null } }); setProviderDialogOpen(true); }}
                    disabled={busy}
                    browseDisabled={providerData.loading}
                  />
                </div>
                {detectedRuntimes.length > 0 ? (
                  <div
                    data-onboarding-detected-runtimes-hint
                    className="mt-4 flex items-center gap-2 rounded-xl border border-edge bg-surface-base/70 px-3 py-2 text-xs text-fg-muted"
                  >
                    <span className="flex shrink-0 items-center gap-1">
                      {detectedRuntimes.map((entry) => (
                        <ExternalRuntimeAvatar key={entry.kind} kind={entry.kind} size={16} />
                      ))}
                    </span>
                    <span className="min-w-0 truncate">
                      {language === 'zh'
                        ? `已检测到本机 ${detectedRuntimes.map((entry) => externalRuntimeLabel(entry.kind, 'short')).join('、')}，完成模型配置后可一键接入`
                        : `Detected ${detectedRuntimes.map((entry) => externalRuntimeLabel(entry.kind, 'short')).join(', ')} locally — connect in the next step`}
                    </span>
                  </div>
                ) : null}
                <div className="mt-3 min-h-5">{error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}</div>
                <div className="mt-auto grid grid-cols-[1fr_auto_1fr] items-center gap-3 pt-8">
                  <Button variant="ghost" className="justify-self-start" disabled={busy} onClick={() => dispatch({ type: 'patch', patch: { step: 'callName', error: null } })}>{o.back}</Button>
                  <OnboardingProgress step={step} label={stepLabel} />
                  <div className="justify-self-end">{skipButton}</div>
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
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-10">
                  <OnboardingProgress step={step} label={stepLabel} />
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    {skipButton}
                    <Button variant="primary" className="h-11 px-5" disabled={busy} onClick={() => void completeOnboarding()}>
                      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                      {language === 'zh' ? '开始使用 XOPC' : 'Start using XOPC'}
                      {!busy ? <ChevronRight className="size-4" aria-hidden /> : null}
                    </Button>
                  </div>
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
          setProviderDialogOpen(false);
          dispatch({ type: 'patch', patch: { step: 'success', error: null } });
        }}
      /> : null}
    </div>
  );
}
