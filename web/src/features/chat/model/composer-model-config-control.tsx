import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import { chooseModelThinking } from '@xopcai/gateway-contract';
import { ArrowLeft, ChevronDown, ChevronRight, Zap } from 'lucide-react';
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
    && (
      !sessionModel
      || sessionModel === externalRegistry.data?.runtimeKind
      || sessionModel === 'codex'
      || sessionModel === 'agy'
      || sessionModel === 'claude'
      || sessionModel === 'antigravity'
    ),
  );
  const exactExternalMatch = externalAgentId
    ? models.find((model) => model.id === sessionModel)
    : undefined;
  const externalFallbackModel = externalAgentId && registryLoaded && models.length > 0 && !exactExternalMatch
    ? (models.find((model) => model.id === externalDefaultId) ?? models[0])
    : undefined;
  const resolvedSessionModel = externalFallbackModel
    ? externalFallbackModel.id
    : (isExternalPlaceholder && externalDefaultId ? externalDefaultId : sessionModel);
  const selected = externalAgentId
    ? (exactExternalMatch ?? externalFallbackModel)
    : models.find((model) => model.id === resolvedSessionModel);
  const activeModelId = selected?.id ?? resolvedSessionModel;
  const unavailable = Boolean(!externalAgentId && resolvedSessionModel && registryLoaded && !selected && models.length > 0);
  const autoHealedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!externalAgentId || !externalFallbackModel || modelDisabled) return;
    if (externalFallbackModel.id === sessionModel) return;
    const syncKey = `${externalAgentId}\0${sessionModel}\0${externalFallbackModel.id}`;
    if (autoHealedKeyRef.current === syncKey) return;
    autoHealedKeyRef.current = syncKey;
    const nextThinking = externalFallbackModel.thinking
      ? chooseModelThinking(externalFallbackModel.thinking, thinkingLevel)
      : thinkingLevel;
    void Promise.resolve(onModelChange(externalFallbackModel.id, nextThinking)).catch(() => {
      // Non-fatal: the composer still displays the resolved runtime default model.
    });
  }, [externalAgentId, externalFallbackModel, modelDisabled, onModelChange, sessionModel, thinkingLevel]);
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
  const serviceTiers = selected?.serviceTiers ?? [];
  const fastTier = onServiceTierChange && serviceTiers.length > 0
    ? (serviceTiers.find((tier) => tier.id === 'fast' || tier.id === 'priority' || tier.label.toLowerCase() === 'fast') ?? serviceTiers[0])
    : undefined;
  const isFastActive = Boolean(
    fastTier && serviceTier && serviceTier !== 'default'
    && (serviceTier === fastTier.id || serviceTiers.some((tier) => tier.id === serviceTier)),
  );
  const speedMatch = fastTier?.description?.match(/(\d+(?:\.\d+)?x)\s*speed/i);
  const fastSpeedTitle = speedMatch
    ? (language === 'zh' ? `${speedMatch[1]} 极速` : `${speedMatch[1]} speed`)
    : (language === 'zh' ? '1.5x 极速' : '1.5x speed');
  const fastUsageSubtitle = language === 'zh' ? '消耗更多额度' : 'More usage';
  const fastButtonLabel = language === 'zh'
    ? `极速模式（${fastSpeedTitle}，${fastUsageSubtitle}）`
    : `${fastTier?.label ?? 'Fast'} mode (${fastSpeedTitle}, ${fastUsageSubtitle})`;
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

  const fastControl = fastTier && onServiceTierChange ? (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={fastButtonLabel}
            aria-pressed={isFastActive}
            disabled={busy}
            onClick={() => void save(() => onServiceTierChange(isFastActive ? 'default' : fastTier.id))}
            className={cn(
              'flex size-9 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              isFastActive
                ? 'bg-surface-active text-fg'
                : 'text-fg-subtle hover:bg-surface-hover hover:text-fg',
              interaction.focusRingPanel,
            )}
          >
            <Zap className={cn('size-4', isFastActive && 'fill-current')} aria-hidden />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            align="start"
            sideOffset={10}
            className={cn(
              APP_PORTALED_POPOVER_Z,
              'rounded-xl border border-edge bg-surface-overlay px-3 py-2 text-left shadow-popover',
            )}
          >
            <p className="text-sm font-medium leading-tight text-fg">{fastSpeedTitle}</p>
            <p className="mt-0.5 text-xs leading-tight text-fg-muted">{fastUsageSubtitle}</p>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  ) : undefined;

  const modelControl = <button ref={modelButtonRef} type="button" disabled={busy || !models.length} onClick={() => setView('models')}
    title={activeModelId} className={cn('mx-auto flex min-h-8 max-w-full items-center justify-center gap-1 rounded-lg px-2 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg', interaction.focusRingPanel)}>
    <span className="min-w-0 truncate">{title}{provider && <span className="text-fg-subtle"> · {provider}</span>}</span><ChevronRight className="size-3.5 shrink-0" aria-hidden />
  </button>;

  return (
    <Popover.Root onOpenChange={(open) => { if (!open) { setView('config'); setError(''); } }}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={`${m.modelConfigLabel}: ${modelIdentity}${effort ? ` · ${effort}` : ''}${isFastActive ? ` · ${fastTier?.label ?? 'Fast'}` : ''}`} title={modelIdentity}
          className={cn('inline-flex h-8 min-w-0 max-w-[min(18rem,calc(100vw-10rem))] items-center gap-1.5 rounded-lg bg-surface-hover/70 px-2.5 text-[13px] text-fg hover:bg-surface-hover', interaction.focusRingPanel, interaction.transition)}>
          {registryLoading || (!activeModelId && models.length > 0) ? <Skeleton className="h-4 w-28" /> : <>
            {isFastActive && <Zap className="size-3.5 shrink-0 fill-current text-fg-muted" aria-hidden />}
            <span className="min-w-0 truncate font-medium">{title}</span>
            {unavailable ? <span className="shrink-0 text-fg-muted">{m.modelUnavailable}</span>
              : effort && <span className="shrink-0 text-fg-muted">· {effort}</span>}
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
              {!adjustable && (
                fastControl ? (
                  <div className="relative px-1 pt-1">
                    <div className="absolute -left-2 -top-2">{fastControl}</div>
                    <div className="px-8">{modelControl}</div>
                  </div>
                ) : modelControl
              )}
              {unavailable && <p className="px-3 py-2 text-sm text-fg-muted">{m.modelUnavailable}</p>}
              {externalAgentId && !models.length && externalRegistry.data?.message && (
                <p className="px-3 py-2 text-center text-xs text-fg-muted">{externalRegistry.data.message}</p>
              )}
              {selected && <div>
                {adjustable ? <ThinkingEffortSlider options={thinking.options} value={effectiveThinkingLevel}
                  label={m.modelThinkingLabel} levelLabel={levelLabel} disabled={busy || thinkingDisabled}
                  modelControl={modelControl} leadingControl={fastControl} resetLabel={m.modelThinkingReset} defaultValue={thinking.initialValue}
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
