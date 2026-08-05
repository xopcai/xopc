import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Pause,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Unplug,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConnectorLogo } from '@/features/connectors/components/connector-logo';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { formatMediumDateTime } from '@/lib/date-formatters';

import { personalContextSourceBranding } from './source-branding';
import type { PersonalContextSource } from './user-context-api';

type YouMessages = ReturnType<typeof messages>['you'];
type SourcePresentation = {
  summary: string;
  tone: 'attention' | 'learning' | 'review' | 'useful' | 'neutral' | 'paused';
  badge?: string;
};

function replace(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{{${key}}}`, String(value)),
    template,
  );
}

function isActive(source: PersonalContextSource): boolean {
  return source.status === 'active' || source.status === 'connected';
}

function sourcePresentation(source: PersonalContextSource, t: YouMessages): SourcePresentation {
  if (!isActive(source) || source.learning?.status === 'failed' || source.lastSyncStatus === 'failed') {
    return { summary: t.sourceNeedsAttention, tone: 'attention', badge: t.attentionTitle };
  }
  if (source.learning?.status === 'paused') {
    return { summary: t.sourcePausedSummary, tone: 'paused', badge: t.paused };
  }
  if (source.learning?.status === 'queued' || source.learning?.status === 'running') {
    return { summary: t.sourceReading, tone: 'learning' };
  }
  if (source.learningFunnel.provisionalClaims > 0) {
    return {
      summary: replace(t.sourcePendingReview, { count: source.learningFunnel.provisionalClaims }),
      tone: 'review',
    };
  }
  if (source.learningFunnel.activeClaims > 0) {
    return {
      summary: replace(t.sourceReliable, { count: source.learningFunnel.activeClaims }),
      tone: 'useful',
    };
  }
  if (source.learningFunnel.attributedItems > 0) {
    return {
      summary: replace(t.sourceStillLearning, { count: source.learningFunnel.attributedItems }),
      tone: 'learning',
    };
  }
  if (source.learningFunnel.indexedItems > 0) {
    return {
      summary: replace(t.sourceNoPersonalSignal, { count: source.learningFunnel.indexedItems }),
      tone: 'neutral',
    };
  }
  if (source.learning?.status === 'completed') {
    return { summary: t.sourceNoRecentSignal, tone: 'neutral' };
  }
  return { summary: t.sourcePreparing, tone: 'learning' };
}

function sourcePurpose(source: PersonalContextSource, t: YouMessages): string {
  const id = source.id.toLocaleLowerCase();
  if (/(github|gitlab|linear|jira)/.test(id)) return t.sourcePurposeWork;
  if (/(gmail|outlook|slack|teams)/.test(id)) return t.sourcePurposeCommunication;
  if (/calendar/.test(id)) return t.sourcePurposeSchedule;
  if (/(docs|drive|notion|sheets|excel|onedrive|one-drive|local-files)/.test(id)) return t.sourcePurposeDocuments;
  return t.sourcePurposeDefault;
}

function accountLabel(source: PersonalContextSource, t: YouMessages): string {
  if (source.accountLabel) return source.accountLabel;
  if (source.accountCount && source.accountCount > 1 && source.accountOrdinal) {
    return replace(t.sourceAccountFallback, { index: source.accountOrdinal, count: source.accountCount });
  }
  return t.sourceUnknownAccount;
}

function updatedAt(source: PersonalContextSource): string | undefined {
  return source.lastSyncAt ?? source.learning?.updatedAt ?? source.lastActivityAt ?? source.lastConnectedAt;
}

function formatDateTime(value: string, language: 'en' | 'zh'): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? formatMediumDateTime(timestamp, language) : value;
}

function presentationRank(source: PersonalContextSource, t: YouMessages): number {
  const tone = sourcePresentation(source, t).tone;
  return { attention: 0, learning: 1, review: 2, useful: 3, paused: 4, neutral: 5 }[tone];
}

function SourceAccountDetail({
  source,
  language,
  t,
  busy,
  onOpenChange,
  onLearn,
  onPause,
  onConfigure,
  onDisconnect,
  onViewUnderstanding,
}: {
  source: PersonalContextSource | null;
  language: 'en' | 'zh';
  t: YouMessages;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onLearn: (source: PersonalContextSource) => void;
  onPause: (source: PersonalContextSource) => void;
  onConfigure: (source: PersonalContextSource) => void;
  onDisconnect: (source: PersonalContextSource) => void;
  onViewUnderstanding: () => void;
}) {
  if (!source) return null;
  const presentation = sourcePresentation(source, t);
  const lastUpdatedAt = updatedAt(source);
  const learningPaused = source.learning?.status === 'paused';
  const needsRetry = presentation.tone === 'attention';

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[130] bg-scrim" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-[131] flex h-dvh w-[min(34rem,100vw)] flex-col overflow-hidden border-l border-edge bg-surface-panel shadow-elevated">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge-subtle px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <ConnectorLogo connector={{ displayName: source.displayName, branding: personalContextSourceBranding(source) }} size="sm" />
              <div className="min-w-0">
                <Dialog.Title className="truncate text-base font-semibold text-fg">{source.displayName}</Dialog.Title>
                <Dialog.Description className="mt-0.5 truncate text-sm text-fg-muted">{accountLabel(source, t)}</Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={t.close}>
                <X className="size-4" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <section>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><Brain className="size-4 text-accent" aria-hidden />{t.sourceOutcomeTitle}</h3>
              <p className={cn(
                'mt-3 rounded-xl border px-4 py-3 text-sm leading-6',
                presentation.tone === 'attention' ? 'border-warning/30 bg-warning-soft text-fg' : 'border-edge-subtle bg-surface-muted text-fg',
              )}>{presentation.summary}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-edge-subtle bg-surface-base px-4 py-3"><strong className="text-xl font-semibold text-fg">{source.learningFunnel.activeClaims}</strong><span className="mt-1 block text-xs text-fg-muted">{t.sourceReliableMetric}</span></div>
                <div className="rounded-xl border border-edge-subtle bg-surface-base px-4 py-3"><strong className="text-xl font-semibold text-fg">{source.learningFunnel.provisionalClaims}</strong><span className="mt-1 block text-xs text-fg-muted">{t.sourcePendingMetric}</span></div>
              </div>
              {(source.learningFunnel.activeClaims > 0 || source.learningFunnel.provisionalClaims > 0) ? (
                <Button type="button" variant="ghost" className="mt-2 px-2" onClick={onViewUnderstanding}>{t.sourceViewUnderstanding}<ChevronRight className="size-4" aria-hidden /></Button>
              ) : null}
            </section>

            <section className="border-t border-edge-subtle pt-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><Clock3 className="size-4 text-accent" aria-hidden />{t.sourceRecentRunTitle}</h3>
              <p className="mt-3 text-sm leading-6 text-fg-muted">{replace(t.sourceRecentRunSummary, {
                indexed: source.learningFunnel.indexedItems,
                attributed: source.learningFunnel.attributedItems,
                claims: source.learningFunnel.activeClaims,
              })}</p>
              {lastUpdatedAt ? <p className="mt-2 text-xs text-fg-subtle">{replace(t.sourceUpdatedAt, { time: formatDateTime(lastUpdatedAt, language) })}</p> : null}
            </section>

            <section className="border-t border-edge-subtle pt-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><ShieldCheck className="size-4 text-accent" aria-hidden />{t.sourceAccessTitle}</h3>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-fg-muted">
                <li className="flex gap-2"><CheckCircle2 className="mt-1 size-4 shrink-0 text-success" aria-hidden /><span>{t.sourceReadAccess}</span></li>
                <li className="flex gap-2"><CheckCircle2 className="mt-1 size-4 shrink-0 text-success" aria-hidden /><span>{t.sourceMemoryAccess}</span></li>
                <li className="flex gap-2"><ShieldCheck className="mt-1 size-4 shrink-0 text-fg-subtle" aria-hidden /><span>{source.access.write ? t.sourceWriteAccess : t.sourceNoWriteAccess}</span></li>
              </ul>
            </section>
          </div>

          <div className="shrink-0 border-t border-edge-subtle p-4">
            <p className="mb-2 px-1 text-xs font-medium text-fg-subtle">{t.sourceManagementTitle}</p>
            <div className="flex flex-wrap gap-2">
              {isActive(source) ? (
                learningPaused || needsRetry ? (
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => onLearn(source)}>
                    {busy ? <RefreshCw className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                    {needsRetry ? t.sourceRetryLearning : t.sourceResumeLearning}
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => onPause(source)}><Pause className="size-4" aria-hidden />{t.sourcePauseLearning}</Button>
                )
              ) : null}
              <Button type="button" variant="secondary" onClick={() => onConfigure(source)}><Settings className="size-4" aria-hidden />{t.sourceConnectionSettings}</Button>
              <Button type="button" variant="ghost" className="ml-auto text-danger hover:bg-danger-soft hover:text-danger" onClick={() => onDisconnect(source)}><Unplug className="size-4" aria-hidden />{t.disconnect}</Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SourcesPanel({
  sources,
  language,
  t,
  busyId,
  onAddSource,
  onLearn,
  onPause,
  onConfigure,
  onDisconnect,
  onViewUnderstanding,
}: {
  sources: PersonalContextSource[];
  language: 'en' | 'zh';
  t: YouMessages;
  busyId: string | null;
  onAddSource: () => void;
  onLearn: (source: PersonalContextSource) => void;
  onPause: (source: PersonalContextSource) => void;
  onConfigure: (source: PersonalContextSource) => void;
  onDisconnect: (source: PersonalContextSource) => void;
  onViewUnderstanding: () => void;
}) {
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const groups = useMemo(() => {
    const installed = sources.filter((source) => source.installed);
    const bySource = new Map<string, PersonalContextSource[]>();
    for (const source of installed) {
      const current = bySource.get(source.id) ?? [];
      current.push(source);
      bySource.set(source.id, current);
    }
    return [...bySource.values()]
      .map((accounts) => ({
        source: accounts[0],
        accounts: accounts.sort((left, right) => (
          presentationRank(left, t) - presentationRank(right, t)
          || accountLabel(left, t).localeCompare(accountLabel(right, t))
        )),
      }))
      .sort((left, right) => (
        Math.min(...left.accounts.map((source) => presentationRank(source, t)))
        - Math.min(...right.accounts.map((source) => presentationRank(source, t)))
        || left.source.displayName.localeCompare(right.source.displayName)
      ));
  }, [sources, t]);
  const accountCount = groups.reduce((total, group) => total + group.accounts.length, 0);
  const selectedSource = selectedInstanceId
    ? sources.find((source) => source.instanceId === selectedInstanceId) ?? null
    : null;

  return (
    <div id="you-panel-sources" role="tabpanel" aria-labelledby="you-tab-sources" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">{t.sourcesTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{t.sourcesSubtitle}</p>
          {groups.length > 0 ? <p className="mt-2 text-xs text-fg-subtle">{replace(t.sourceConnectedSummary, { accounts: accountCount, sources: groups.length })}</p> : null}
        </div>
        <Button type="button" variant="primary" onClick={onAddSource}><Plus className="size-4" aria-hidden />{t.addSource}</Button>
      </div>

      {groups.length > 0 ? (
        <div className="space-y-3">
          {groups.map(({ source, accounts }) => (
            <section key={source.id} className="overflow-hidden rounded-2xl border border-edge-subtle bg-surface-base">
              <div className="flex items-start gap-3 border-b border-edge-subtle px-4 py-3.5 sm:px-5">
                <ConnectorLogo connector={{ displayName: source.displayName, branding: personalContextSourceBranding(source) }} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-sm font-semibold text-fg">{source.displayName}</h3>
                    {accounts.length > 1 ? <span className="text-xs text-fg-subtle">{replace(t.sourceAccountCount, { count: accounts.length })}</span> : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-fg-muted">{sourcePurpose(source, t)}</p>
                </div>
              </div>
              <div className="divide-y divide-edge-subtle">
                {accounts.map((account) => {
                  const presentation = sourcePresentation(account, t);
                  const lastUpdatedAt = updatedAt(account);
                  return (
                    <button
                      key={account.instanceId}
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 sm:px-5"
                      onClick={() => setSelectedInstanceId(account.instanceId ?? null)}
                    >
                      <span className={cn(
                        'size-2 shrink-0 rounded-full',
                        presentation.tone === 'attention' ? 'bg-warning' : presentation.tone === 'useful' ? 'bg-success' : presentation.tone === 'learning' ? 'bg-accent' : 'bg-fg-subtle/50',
                      )} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-fg">{accountLabel(account, t)}</span>
                          {presentation.badge ? <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', presentation.tone === 'attention' ? 'bg-warning-soft text-fg' : 'bg-surface-muted text-fg-muted')}>{presentation.badge}</span> : null}
                        </span>
                        <span className={cn('mt-1 block text-xs leading-5', presentation.tone === 'attention' ? 'text-fg' : 'text-fg-muted')}>{presentation.summary}</span>
                      </span>
                      {lastUpdatedAt ? <span className="hidden shrink-0 text-xs text-fg-subtle sm:block">{replace(t.sourceUpdatedAt, { time: formatDateTime(lastUpdatedAt, language) })}</span> : null}
                      <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-edge p-10 text-center">
          <AlertCircle className="mx-auto size-5 text-fg-subtle" aria-hidden />
          <p className="mt-2 text-sm text-fg-muted">{t.noSources}</p>
          <Button type="button" variant="secondary" className="mt-4" onClick={onAddSource}><Plus className="size-4" aria-hidden />{t.addSource}</Button>
        </div>
      )}

      <SourceAccountDetail
        source={selectedSource}
        language={language}
        t={t}
        busy={selectedSource ? busyId === `source-learning:${selectedSource.instanceId}` : false}
        onOpenChange={(open) => { if (!open) setSelectedInstanceId(null); }}
        onLearn={onLearn}
        onPause={onPause}
        onConfigure={(source) => { setSelectedInstanceId(null); onConfigure(source); }}
        onDisconnect={(source) => { setSelectedInstanceId(null); onDisconnect(source); }}
        onViewUnderstanding={() => { setSelectedInstanceId(null); onViewUnderstanding(); }}
      />
    </div>
  );
}
