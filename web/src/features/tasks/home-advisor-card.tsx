import type {
  HomeAdvisor,
  HomeCapabilityPreflight,
  HomeOpportunity,
  HomeOpportunityActionRequest,
  HomeOpportunityFeedbackRequest,
} from '@xopcai/gateway-contract';
import { ChevronDown, Clock3, MessageCircle, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

type FeedbackKind = HomeOpportunityFeedbackRequest['kind'];

interface HomeAdvisorCopy {
  aiLabel: string;
  why: string;
  evidence: string;
  needsSetup: string;
  start: string;
  discuss: string;
  refresh: string;
  refreshing: string;
  alternatives: string;
  feedback: string;
  alreadyDone: string;
  irrelevant: string;
  later: string;
  lessLikeThis: string;
  sourceIncorrect: string;
  minutes: string;
  setupTitle: string;
  setupHint: string;
  configure: string;
  degradedStart: string;
  sceneHint: string;
  sceneAction: string;
  automationHint: string;
  automationAction: string;
}

function OpportunityBody({ opportunity, copy }: { opportunity: HomeOpportunity; copy: HomeAdvisorCopy }) {
  const missing = opportunity.capabilities.filter((item) => item.readiness !== 'ready');
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
        <span>{copy.aiLabel}</span>
        {opportunity.estimatedMinutes ? (
          <span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" aria-hidden />{opportunity.estimatedMinutes} {copy.minutes}</span>
        ) : null}
      </div>
      <h3 className="mt-3 text-xl font-semibold leading-7 tracking-tight text-fg">{opportunity.title}</h3>
      <p className="mt-2 text-sm leading-6 text-fg-muted">{opportunity.outcome}</p>
      <p className="mt-4 text-sm leading-6 text-fg-muted"><span className="font-medium text-fg">{copy.why}：</span>{opportunity.rationale}</p>
      {opportunity.continuation ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-edge bg-surface-subtle p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-fg-muted">
            {opportunity.continuation.kind === 'automation' ? copy.automationHint : copy.sceneHint}
          </p>
          <a href={`#${opportunity.continuation.href}`} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-xs font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {opportunity.continuation.kind === 'automation' ? copy.automationAction : copy.sceneAction}
          </a>
        </div>
      ) : null}
      {missing.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" aria-label={copy.needsSetup}>
          {missing.map((item) => (
            <a key={`${item.kind}:${item.capability}`} href={`#${item.recoveryPath ?? '/settings'}`} className="rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-xs text-accent hover:border-accent/50">
              {copy.needsSetup} · {item.capability}
            </a>
          ))}
        </div>
      ) : null}
      <details className="mt-4 group">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {copy.evidence}
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <ul className="mt-2 space-y-2 border-l border-edge pl-3 text-xs leading-5 text-fg-muted">
          {opportunity.evidence.map((item) => (
            <li key={item.id}>
              {item.href ? <a href={`#${item.href}`} className="hover:text-accent hover:underline">{item.observation}</a> : item.observation}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

export function HomeAdvisorCard({
  advisor,
  copy,
  busy,
  onRefresh,
  onAction,
  onFeedback,
  onClarification,
  preflight,
}: {
  advisor: HomeAdvisor;
  copy: HomeAdvisorCopy;
  busy: boolean;
  onRefresh(): void;
  onAction(opportunity: HomeOpportunity, mode: HomeOpportunityActionRequest['mode']): void;
  onFeedback(opportunity: HomeOpportunity, kind: FeedbackKind): void;
  onClarification(question: string, answer: string): void;
  preflight?: { opportunityId: string; value: HomeCapabilityPreflight };
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const opportunities = advisor.state === 'ready' ? [advisor.primary, ...advisor.alternatives] : [];
  const selected = opportunities.find((item) => item.id === selectedId) ?? opportunities[0];
  useEffect(() => setSelectedId(opportunities[0]?.id), [advisor.state, opportunities[0]?.id]);

  if (advisor.state === 'disabled' || advisor.state === 'quiet') return null;
  if (advisor.state === 'refreshing') {
    return (
      <section className="mt-7 rounded-2xl border border-accent/20 bg-accent-soft/40 px-5 py-5" aria-live="polite" aria-busy>
        <div className="flex items-center gap-2 text-sm font-medium text-accent"><Sparkles className="size-4" aria-hidden />{copy.refreshing}</div>
        {advisor.previous ? <p className="mt-2 text-sm text-fg-muted">{advisor.previous.title}</p> : null}
      </section>
    );
  }
  if (advisor.state === 'clarification') {
    return (
      <section className="mt-7 rounded-2xl border border-accent/25 bg-surface-base px-5 py-5" aria-labelledby="home-advisor-question">
        <div className="flex items-center gap-2 text-xs font-medium text-accent"><Sparkles className="size-4" aria-hidden />{copy.aiLabel}</div>
        <h3 id="home-advisor-question" className="mt-3 text-lg font-semibold text-fg">{advisor.question.question}</h3>
        <div className="mt-4 flex flex-wrap gap-2">
          {advisor.question.options.map((option) => (
            <Button key={option.id} type="button" variant="secondary" className="min-h-11" onClick={() => onClarification(advisor.question.question, option.label)}>{option.label}</Button>
          ))}
        </div>
      </section>
    );
  }
  if (!selected) return null;
  const selectedPreflight = preflight?.opportunityId === selected.id ? preflight.value : undefined;
  return (
    <section className="mt-7 rounded-2xl border border-accent/25 bg-surface-base" aria-label={copy.aiLabel}>
      <div className="px-5 py-5 sm:px-6">
        {advisor.stale ? <p className="mb-3 inline-flex items-center gap-2 text-xs text-accent"><RefreshCw className="size-3.5 animate-spin" aria-hidden />{copy.refreshing}</p> : null}
        <OpportunityBody opportunity={selected} copy={copy} />
        {selectedPreflight?.state === 'needs_setup' ? (
          <div className="mt-5 rounded-xl border border-accent/25 bg-accent-soft/40 p-4" role="alert" aria-live="polite">
            <div className="flex gap-3">
              <Settings2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">{copy.setupTitle}</p>
                <p className="mt-1 text-xs leading-5 text-fg-muted">{copy.setupHint}</p>
                <ul className="mt-2 space-y-1 text-xs leading-5 text-fg-muted">
                  {selectedPreflight.blockers.map((blocker) => (
                    <li key={`${blocker.kind}:${blocker.capability}`}>{blocker.message}</li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedPreflight.recoveryActions.map((action) => (
                    <a key={action.capability} href={`#${action.href}`} className="inline-flex min-h-11 items-center rounded-lg border border-accent/30 px-3 text-xs font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                      {copy.configure} · {action.capability}
                    </a>
                  ))}
                  {selectedPreflight.degradedAction ? (
                    <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => onAction(selected, 'degraded_start')}>
                      {copy.degradedStart}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {selected.actions.canStart ? (
            <Button type="button" variant="primary" className="min-h-11" disabled={busy} onClick={() => onAction(selected, 'start')}>
              <Sparkles className="size-4" aria-hidden />{copy.start}
            </Button>
          ) : null}
          {selected.actions.canDiscuss ? (
            <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => onAction(selected, 'discuss')}>
              <MessageCircle className="size-4" aria-hidden />{copy.discuss}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={onRefresh} title={copy.refresh}>
            <RefreshCw className="size-4" aria-hidden />{copy.refresh}
          </Button>
          <details className="relative ml-auto">
            <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg px-3 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{copy.feedback}</summary>
            <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-edge bg-surface-overlay p-1 shadow-float">
              {([
                ['already_done', copy.alreadyDone],
                ['irrelevant', copy.irrelevant],
                ['too_early', copy.later],
                ['source_incorrect', copy.sourceIncorrect],
                ['less_like_this', copy.lessLikeThis],
              ] as Array<[FeedbackKind, string]>).map(([kind, label]) => (
                <button key={kind} type="button" className="min-h-10 w-full rounded-lg px-3 text-left text-sm text-fg-muted hover:bg-surface-hover hover:text-fg" onClick={() => onFeedback(selected, kind)}>{label}</button>
              ))}
            </div>
          </details>
        </div>
      </div>
      {opportunities.length > 1 ? (
        <div className="border-t border-edge-subtle px-5 py-4 sm:px-6">
          <p className="text-xs font-medium text-fg-subtle">{copy.alternatives}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {opportunities.filter((item) => item.id !== selected.id).map((item) => (
              <button key={item.id} type="button" className="min-h-10 rounded-lg border border-edge px-3 text-left text-sm text-fg-muted hover:bg-surface-hover hover:text-fg" onClick={() => setSelectedId(item.id)}>{item.title}</button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
