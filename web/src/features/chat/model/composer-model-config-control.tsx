import * as Popover from '@radix-ui/react-popover';
import { ArrowLeft, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached } from '@/features/chat/api/registry-api';
import type { ThinkingLevel } from '@/features/chat/composer/composer.types';
import { ModelPickerList } from '@/features/chat/model/model-selector';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { APP_PORTALED_POPOVER_Z } from '@/lib/settings-shell-dialog-layer';

export function ComposerModelConfigControl({ chat: m, sessionModel, modelDisabled, onModelChange,
  thinkingLevel, thinkingDisabled, onThinkingChange,
}: {
  chat: MessageBundle['chat'];
  sessionModel: string;
  modelDisabled: boolean;
  onModelChange: (modelId: string) => void | Promise<void>;
  thinkingLevel: string;
  modelSupportsThinking: boolean;
  thinkingDisabled: boolean;
  onThinkingChange: (level: string) => void | Promise<void>;
}) {
  const registry = useSWR(CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached, { revalidateOnFocus: false });
  const [view, setView] = useState<'config' | 'models'>('config');
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { (view === 'models' ? backButtonRef : modelButtonRef).current?.focus(); }, [view]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const models = registry.data ?? [];
  const selected = models.find((model) => model.id === sessionModel);
  const unavailable = Boolean(sessionModel && registry.data && !selected);
  const modelLabel = selected?.name || sessionModel.slice(sessionModel.indexOf('/') + 1) || m.modelConfigure;
  const title = modelLabel.split('/').at(-1) || modelLabel;
  const thinking = selected?.thinking;
  const adjustable = thinking?.mode === 'levels' || thinking?.mode === 'toggle';
  const levelLabel = (level: string) => thinking?.mode === 'toggle' && level !== 'off'
    ? m.modelThinkingOn : m.thinkingLevels[level as ThinkingLevel] ?? level;
  const effort = adjustable ? levelLabel(thinkingLevel) : '';
  const busy = pending || modelDisabled;

  async function save(action: () => void | Promise<void>, modelChange = false) {
    setPending(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (modelChange) setView('config');
      setNotice(m.modelConfigSaved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover.Root onOpenChange={(open) => { if (!open) { setView('config'); setError(''); setNotice(''); } }}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={`${m.modelConfigLabel}: ${title}${effort ? ` · ${effort}` : ''}`} title={title}
          className={cn('inline-flex h-8 min-w-0 max-w-[min(18rem,calc(100vw-10rem))] items-center gap-1.5 rounded-lg bg-surface-hover/70 px-2.5 text-[13px] text-fg hover:bg-surface-hover', interaction.focusRingPanel, interaction.transition)}>
          {registry.isLoading || (!sessionModel && models.length > 0) ? <Skeleton className="h-4 w-28" /> : <>
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
          className={cn(APP_PORTALED_POPOVER_Z, 'xopc-composer-config-popover flex h-[min(21rem,calc(100dvh-3rem))] w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel p-2 shadow-popover')}>
          {view === 'models' ? <>
            <button ref={backButtonRef} type="button" onClick={() => setView('config')} className={cn('mb-2 flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-2 text-sm text-fg hover:bg-surface-hover', interaction.focusRingPanel)}>
              <ArrowLeft className="size-4" aria-hidden />{m.modelBack}
            </button>
            <ModelPickerList models={models} value={sessionModel} disabled={busy}
              searchPlaceholder={m.modelSearchPlaceholder} noMatches={m.modelNoMatches}
              onChange={(id) => void save(() => onModelChange(id), true)} />
          </> : <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {registry.isLoading ? <div className="space-y-4 p-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-24" /><Skeleton className="h-11 w-full" /></div> : <>
              <button ref={modelButtonRef} type="button" disabled={busy || !models.length} onClick={() => setView('models')}
                className={cn('flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-60', interaction.focusRingPanel)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{modelLabel}</span>
                  <span className="block truncate text-xs text-fg-muted" title={sessionModel}>{selected?.provider || sessionModel}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-fg-muted" aria-hidden />
              </button>
              {unavailable && <p className="px-3 py-2 text-sm text-fg-muted">{m.modelUnavailable}</p>}
              {selected && <div className="mt-4 px-3">
                <p className="mb-2 text-xs font-medium text-fg-muted">{m.modelThinkingLabel}</p>
                {adjustable ? <div role="group" aria-label={m.modelThinkingLabel} className={cn('grid gap-1 rounded-lg bg-surface-base p-1', thinking.options.length > 4 ? 'grid-cols-3' : thinking.options.length === 4 ? 'grid-cols-4' : thinking.options.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
                  {thinking.options.map((level) => <button key={level} type="button" aria-pressed={level === thinkingLevel}
                    disabled={busy || thinkingDisabled} onClick={() => void save(() => onThinkingChange(level))}
                    className={cn('min-h-11 min-w-11 flex-1 rounded-md px-2 text-sm text-fg hover:bg-surface-hover disabled:opacity-50', interaction.focusRingPanel,
                      level === thinkingLevel && 'bg-accent-soft font-medium text-accent-fg')}>
                    {levelLabel(level)}
                  </button>)}
                </div> : <p className="text-sm text-fg-muted">{thinking?.mode === 'none' ? m.thinkingUnsupported : m.modelThinkingUnknown}</p>}
              </div>}
            </>}
          </div>}
          <div className="shrink-0 px-3 py-2 text-xs" aria-live="polite">
            {pending ? <span className="inline-flex items-center gap-2 text-fg-muted"><Loader2 className="size-3 animate-spin" aria-hidden />{m.modelConfigSaving}</span>
              : error ? <span role="alert" className="text-danger">{error}</span>
              : registry.error ? <button type="button" onClick={() => void registry.mutate()} className={cn('text-accent-fg', interaction.focusRingPanel)}>{m.modelRetry}</button>
              : notice ? <span className="text-fg-muted">{notice} · {title}{effort ? ` · ${effort}` : ''}</span> : null}
          </div>
          <Link to="/settings/capabilities/models" className={cn('shrink-0 rounded-lg border-t border-edge-subtle px-3 py-3 text-sm text-fg-muted hover:bg-surface-hover', interaction.focusRingPanel)}>
            {models.length ? m.modelManage : m.modelConfigure}
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
