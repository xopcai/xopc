import * as Popover from '@radix-ui/react-popover';
import { chooseModelThinking } from '@xopcai/gateway-contract';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import {
  agentRuntimeModelsSwrKey,
  CONFIGURED_MODELS_SWR_KEY,
  fetchAgentRuntimeModelsCached,
  fetchConfiguredModelsCached,
} from '@/features/chat/api/registry-api';
import type { ThinkingLevel } from '@/features/chat/composer/composer.types';
import { ThinkingEffortSlider } from '@/features/chat/model/thinking-effort-slider';
import { ModelPickerList } from '@/features/chat/model/model-selector';
import type { MessageBundle } from '@/i18n/messages';
import { modelDisplayName } from '@/lib/model-display-name';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { APP_PORTALED_POPOVER_Z } from '@/lib/settings-shell-dialog-layer';

export function ComposerModelConfigControl({ chat: m, sessionModel, modelDisabled, onModelChange,
  thinkingLevel, thinkingDisabled, onThinkingChange, externalAgentId,
  interactionMode = 'default', interactionModeDisabled = false, onInteractionModeChange,
  serviceTier = 'default', onServiceTierChange,
}: {
  chat: MessageBundle['chat'];
  sessionModel: string;
  modelDisabled: boolean;
  onModelChange: (modelId: string, thinkingLevel?: string) => void | Promise<void>;
  thinkingLevel: string;
  thinkingDisabled: boolean;
  onThinkingChange: (level: string) => void | Promise<void>;
  /** When set, loads models and thinking capabilities from this external runtime agent instead of built-in providers. */
  externalAgentId?: string;
  interactionMode?: 'default' | 'plan';
  interactionModeDisabled?: boolean;
  onInteractionModeChange?: (mode: 'default' | 'plan') => void | Promise<void>;
  serviceTier?: string;
  onServiceTierChange?: (tier: string) => void | Promise<void>;
}) {
  const language = useLocaleStore((s) => s.language);
  const builtinRegistry = useSWR(
    externalAgentId ? null : CONFIGURED_MODELS_SWR_KEY,
    fetchConfiguredModelsCached,
    { revalidateOnFocus: false },
  );
  const externalRegistry = useSWR(
    externalAgentId ? agentRuntimeModelsSwrKey(externalAgentId) : null,
    () => fetchAgentRuntimeModelsCached(externalAgentId!),
    { revalidateOnFocus: false },
  );
  const registryLoading = externalAgentId ? externalRegistry.isLoading : builtinRegistry.isLoading;
  const registryError = externalAgentId ? externalRegistry.error : builtinRegistry.error;
  const registryLoaded = externalAgentId ? Boolean(externalRegistry.data) : Boolean(builtinRegistry.data);
  const revalidateRegistry = () => (externalAgentId ? externalRegistry.mutate() : builtinRegistry.mutate());

  const [view, setView] = useState<'config' | 'models'>('config');
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { (view === 'models' ? backButtonRef : modelButtonRef).current?.focus(); }, [view]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const models = externalAgentId ? (externalRegistry.data?.models ?? []) : (builtinRegistry.data ?? []);
  const externalDefaultId = externalAgentId ? externalRegistry.data?.defaultModel : undefined;
  const isExternalPlaceholder = Boolean(
    externalAgentId
    && (!sessionModel || sessionModel === externalRegistry.data?.runtimeKind || sessionModel === 'antigravity'),
  );
  const resolvedSessionModel = isExternalPlaceholder && externalDefaultId ? externalDefaultId : sessionModel;
  const selected = models.find((model) => model.id === resolvedSessionModel)
    ?? (externalAgentId && isExternalPlaceholder ? models.find((model) => model.id === externalDefaultId) ?? models[0] : undefined);
  const activeModelId = selected?.id ?? resolvedSessionModel;
  const unavailable = Boolean(resolvedSessionModel && registryLoaded && !selected && models.length > 0);
  const modelLabel = selected ? modelDisplayName(selected, language) : resolvedSessionModel.slice(resolvedSessionModel.indexOf('/') + 1) || m.modelConfigure;
  const title = modelLabel.split('/').at(-1) || modelLabel;
  const provider = selected?.provider
    || (externalAgentId ? (externalRegistry.data?.runtimeLabel ?? '') : (resolvedSessionModel.includes('/') ? resolvedSessionModel.slice(0, resolvedSessionModel.indexOf('/')) : ''));
  const modelIdentity = provider ? `${title} · ${provider}` : title;
  const thinking = selected?.thinking;
  const adjustable = thinking?.mode === 'levels' || thinking?.mode === 'toggle';
  const effectiveThinkingLevel = thinking
    ? chooseModelThinking(thinking, thinkingLevel)
    : thinkingLevel;
  const levelLabel = (level: string) => thinking?.mode === 'toggle' && level !== 'off'
    ? m.modelThinkingOn : m.thinkingLevels[level as ThinkingLevel] ?? level;
  const effort = adjustable
    ? levelLabel(effectiveThinkingLevel)
    : thinking?.mode === 'fixed' ? m.modelThinkingFixed : '';
  const busy = pending || modelDisabled;

  async function save(action: () => void | Promise<void>, modelChange = false) {
    setPending(true);
    setError('');
    try {
      await action();
      if (modelChange) setView('config');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  const modelControl = <button ref={modelButtonRef} type="button" disabled={busy || !models.length} onClick={() => setView('models')}
    title={activeModelId} className={cn('mx-auto flex min-h-8 max-w-full items-center justify-center gap-1 rounded-lg px-2 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg', interaction.focusRingPanel)}>
    <span className="min-w-0 truncate">{title}{provider && <span className="text-fg-subtle"> · {provider}</span>}</span><ChevronRight className="size-3.5 shrink-0" aria-hidden />
  </button>;

  return (
    <Popover.Root onOpenChange={(open) => { if (!open) { setView('config'); setError(''); } }}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={`${m.modelConfigLabel}: ${modelIdentity}${effort ? ` · ${effort}` : ''}`} title={modelIdentity}
          className={cn('inline-flex h-8 min-w-0 max-w-[min(18rem,calc(100vw-10rem))] items-center gap-1.5 rounded-lg bg-surface-hover/70 px-2.5 text-[13px] text-fg hover:bg-surface-hover', interaction.focusRingPanel, interaction.transition)}>
          {registryLoading || (!activeModelId && models.length > 0) ? <Skeleton className="h-4 w-28" /> : <>
            <span className="min-w-0 truncate font-medium">{title}</span>
            {unavailable ? <span className="shrink-0 text-fg-muted">{m.modelUnavailable}</span>
              : effort && <span className="shrink-0 text-fg-muted">· {effort}</span>}
            {interactionMode === 'plan' ? (
              <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent-fg">
                {language === 'zh' ? '规划' : 'Plan'}
              </span>
            ) : null}
          </>}
          <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="end" sideOffset={8} collisionPadding={12}
          aria-label={m.modelConfigLabel}
          className={cn(APP_PORTALED_POPOVER_Z, 'xopc-composer-config-popover flex max-h-[min(21rem,calc(100dvh-3rem))] w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay p-3 shadow-popover')}>
          {view === 'models' ? <>
            <button ref={backButtonRef} type="button" onClick={() => setView('config')} className={cn('mb-2 flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-2 text-sm text-fg hover:bg-surface-hover', interaction.focusRingPanel)}>
              <ArrowLeft className="size-4" aria-hidden />{m.modelBack}
            </button>
            <ModelPickerList models={models} value={activeModelId} disabled={busy} groupByProvider={!externalAgentId}
              searchPlaceholder={m.modelSearchPlaceholder} noMatches={m.modelNoMatches}
              onChange={(id) => {
                const nextModel = models.find((model) => model.id === id);
                const nextThinking = nextModel?.thinking
                  ? chooseModelThinking(nextModel.thinking, effectiveThinkingLevel)
                  : effectiveThinkingLevel;
                void save(() => onModelChange(id, nextThinking), true);
              }} />
          </> : <div className="min-w-0 shrink-0">
            {registryLoading ? <div className="space-y-4 p-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-24" /><Skeleton className="h-11 w-full" /></div> : <>
              {!adjustable && modelControl}
              {unavailable && <p className="px-3 py-2 text-sm text-fg-muted">{m.modelUnavailable}</p>}
              {externalAgentId && !models.length && externalRegistry.data?.message && (
                <p className="px-3 py-2 text-center text-xs text-fg-muted">{externalRegistry.data.message}</p>
              )}
              {selected && <div>
                {adjustable ? <ThinkingEffortSlider options={thinking.options} value={effectiveThinkingLevel}
                  label={m.modelThinkingLabel} levelLabel={levelLabel} disabled={busy || thinkingDisabled}
                  modelControl={modelControl} resetLabel={m.modelThinkingReset} defaultValue={thinking.initialValue}
                  onCommit={level => save(() => (
                    externalAgentId && activeModelId && activeModelId !== sessionModel
                      ? onModelChange(activeModelId, level)
                      : onThinkingChange(level)
                  ))} /> : <p className="px-1 pb-2 text-center text-xs text-fg-muted">{
                  thinking?.mode === 'none' ? m.thinkingUnsupported
                    : thinking?.mode === 'fixed' ? m.modelThinkingFixed
                      : m.modelThinkingUnknown
                }</p>}
              </div>}
              {onServiceTierChange && selected?.serviceTiers && selected.serviceTiers.length > 0 ? (
                <div className="mt-2 border-t border-edge-subtle pt-2.5">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <span className="text-xs font-medium text-fg-muted">
                      {language === 'zh' ? '速度档位' : 'Speed'}
                    </span>
                    <div
                      role="radiogroup"
                      aria-label={language === 'zh' ? '速度档位' : 'Speed'}
                      className="inline-flex flex-wrap justify-end gap-0.5 rounded-lg border border-edge bg-surface-base p-0.5"
                    >
                      {[
                        { id: 'default', label: language === 'zh' ? '标准' : 'Standard' },
                        ...selected.serviceTiers.map((tier) => ({ id: tier.id, label: tier.label })),
                      ].map((opt) => {
                        const active = (serviceTier || 'default') === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            disabled={busy}
                            onClick={() => {
                              if (active) return;
                              void save(() => onServiceTierChange(opt.id));
                            }}
                            className={cn(
                              'rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
                              active
                                ? 'bg-accent-soft text-accent-fg'
                                : 'text-fg-muted hover:text-fg',
                            )}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
              {onInteractionModeChange ? (
                <div className="mt-2 border-t border-edge-subtle pt-2.5">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <span className="text-xs font-medium text-fg-muted">
                      {language === 'zh' ? '协作模式' : 'Mode'}
                    </span>
                    <div
                      role="radiogroup"
                      aria-label={language === 'zh' ? '协作模式' : 'Mode'}
                      className="inline-flex rounded-lg border border-edge bg-surface-base p-0.5"
                    >
                      {([
                        { id: 'default', label: language === 'zh' ? '执行' : 'Build' },
                        { id: 'plan', label: language === 'zh' ? '规划' : 'Plan' },
                      ] as const).map((opt) => {
                        const active = interactionMode === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            disabled={busy || interactionModeDisabled}
                            onClick={() => {
                              if (active) return;
                              void save(() => onInteractionModeChange(opt.id));
                            }}
                            className={cn(
                              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
                              active
                                ? 'bg-accent-soft text-accent-fg'
                                : 'text-fg-muted hover:text-fg',
                            )}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {interactionMode === 'plan' ? (
                    <p className="mt-1.5 px-1 text-[11px] leading-4 text-fg-subtle">
                      {language === 'zh'
                        ? '只读分析并输出方案，不修改文件或执行变更命令。'
                        : 'Read-only planning without editing files or running mutating commands.'}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>}
          </div>}
          {pending && <span className="sr-only" role="status">{m.modelConfigSaving}</span>}
          {(error || registryError) && <div className="shrink-0 break-words px-1 py-2 text-xs" aria-live="polite">
            {error ? <span role="alert" className="text-danger">{error}</span>
              : <button type="button" onClick={() => void revalidateRegistry()} className={cn('text-accent-fg', interaction.focusRingPanel)}>{m.modelRetry}</button>}
          </div>}
          {view === 'models' && <Link to={externalAgentId ? '/settings/agents' : '/settings/capabilities/models'} className={cn('shrink-0 rounded-lg border-t border-edge-subtle px-3 py-3 text-sm text-fg-muted hover:bg-surface-hover', interaction.focusRingPanel)}>
            {models.length ? m.modelManage : m.modelConfigure}
          </Link>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
