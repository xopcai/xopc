import type { UsageTotals, UsageEvent } from '@xopcai/gateway-contract';
import { AlertCircle, Bot, Coins, Database, Gauge, RefreshCw, Timer } from 'lucide-react';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useSearchParams } from 'react-router-dom';

import { SlidingTabList } from '@/components/ui/sliding-tab-list';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { getUsageEvents, getUsageSummary, usageQuery } from '@/features/usage/usage-api';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { XopcCloudAccountCard } from '@/features/settings/models-hub/xopc-cloud-account-card';

function compactNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    notation: 'compact', maximumFractionDigits: 1,
  }).format(value);
}

function money(value: string): string {
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}`;
}

function creditDecimal(micro: string): string {
  const value = BigInt(micro);
  const fraction = String(value % 10000n).padStart(4, '0').replace(/0+$/, '');
  return `${value / 10000n}${fraction ? `.${fraction}` : ''}`;
}

function dateTime(value: number, language: string): string {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(value);
}

function UsageSkeleton() {
  return <div className="space-y-4" aria-busy="true">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map(item => <Skeleton key={item} className="h-24 rounded-xl" />)}
    </div>
    <Skeleton className="h-52 rounded-xl" />
    <Skeleton className="h-72 rounded-xl" />
  </div>;
}

export function UsageSettingsPage() {
  const language = useLocaleStore(state => state.language);
  const t = messages(language).usage;
  const [params, setParams] = useSearchParams();
  const days = ['7', '30', '90'].includes(params.get('days') ?? '') ? params.get('days')! : '7';
  const pageSize = params.get('size') === '50' ? 50 : 20;
  const cursors = params.getAll('cursor');
  const cursor = cursors.at(-1);
  const [initialTo] = useState(() => Date.now() + 1);
  const requestedTo = Number(params.get('to'));
  const to = Number.isSafeInteger(requestedTo) && requestedTo > Number(days) * 86_400_000 ? requestedTo : initialTo;
  const query = useMemo(() => usageQuery(Number(days), to), [days, to]);
  const summary = useSWR(['usage-summary', query], () => getUsageSummary(query), { refreshInterval: 15_000 });
  const events = useSWR(['usage-events', query, cursor, pageSize], () => getUsageEvents(query, cursor, pageSize), { refreshInterval: 15_000 });
  const loading = !summary.data && !summary.error;
  const error = summary.error;
  const updateParams = (update: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    next.set('to', String(to));
    update(next);
    setParams(next);
  };
  const setDays = (value: string) => updateParams(next => {
    next.set('days', value);
    next.set('to', String(Date.now() + 1));
    next.delete('cursor');
    next.delete('groupPage');
  });
  const grouping = params.get('group') === 'model' ? 'model' : 'scenario';
  const groups = [...(grouping === 'model' ? summary.data?.byModel ?? [] : summary.data?.byCategory ?? [])]
    .sort((a, b) => b.totals.calls - a.totals.calls || a.key.localeCompare(b.key));
  const groupPageCount = Math.max(1, Math.ceil((groups?.length ?? 0) / 6));
  const requestedGroupPage = Number(params.get('groupPage'));
  const groupPage = Math.min(groupPageCount, Number.isSafeInteger(requestedGroupPage) && requestedGroupPage > 0 ? requestedGroupPage : 1);
  const visibleGroups = groups?.slice((groupPage - 1) * 6, groupPage * 6);
  const page = cursors.length + 1;
  const totals = summary.data?.totals;
  const cloudUsed = (totals?.billing?.cloud.calls ?? 0) > 0;

  const cloudAmount = (value: UsageTotals) => {
    const cloud = value.billing?.cloud;
    if (!cloud?.calls) return t.noCloudCalls;
    if (cloud.chargedCreditMicro === null) return t.cloudUnconfirmed;
    const prefix = cloud.pendingCalls + cloud.unavailableCalls > 0 ? '≥ ' : '';
    return `${prefix}${creditDecimal(cloud.chargedCreditMicro)} Credits`;
  };
  const externalAmount = (value: UsageTotals) => {
    const external = value.billing?.external;
    if (!external?.calls) return t.noExternalCalls;
    if (external.unknownCostCalls === external.calls) return t.costUnknown;
    return `${external.unknownCostCalls > 0 ? '≥ ' : '≈ '}${money(external.estimatedCostUsd)}`;
  };
  const sourceLabel = (event: UsageEvent) => event.billing?.source === 'local' || (event.provider !== 'xopc-cloud' && event.costSource === 'local') ? t.localSource
    : event.billing?.source === 'xopc_cloud' || event.provider === 'xopc-cloud' ? t.cloudSource : t.externalSource;
  const eventAmount = (event: UsageEvent) => {
    const billing = event.billing;
    if (billing?.source === 'local') return t.localNoCharge;
    if (billing?.source === 'xopc_cloud') {
      if (billing.state === 'settled' && billing.chargedCreditMicro !== null) return `${creditDecimal(billing.chargedCreditMicro)} Credits`;
      if (billing.state === 'released') return t.cloudReleased;
      if (billing.state === 'pending') return billing.reservedCreditMicro !== null
        ? t.cloudPendingReserved.replace('{{credits}}', creditDecimal(billing.reservedCreditMicro)) : t.cloudPending;
      return t.cloudUnconfirmed;
    }
    if (event.provider === 'xopc-cloud') return t.cloudUnconfirmed;
    if (event.costSource === 'local') return t.localNoCharge;
    return event.estimatedCostUsd === undefined ? t.costUnknown : `≈ ${money(event.estimatedCostUsd)}`;
  };
  const breakdown = (value: UsageTotals) => <span className="flex flex-col items-end gap-1 text-xs">
    {value.billing?.cloud.calls ? <span>{t.cloudSource}: {cloudAmount(value)}</span> : null}
    {value.billing?.external.calls ? <span>{t.externalSource}: {externalAmount(value)}</span> : null}
    {value.billing?.localCalls ? <span>{t.localNoCharge}</span> : null}
    <span>{value.calls} {t.callUnit}</span>
  </span>;

  const reasonLabels: Record<string, string> = {
    'usage.reason.imageGeneration': t.reasons.imageGeneration,
    'usage.reason.audioTranscription': t.reasons.audioTranscription,
    'usage.reason.audioSpeech': t.reasons.audioSpeech,
    'usage.reason.agentAnswer': t.reasons.agentAnswer,
    'usage.reason.continueAfterTool': t.reasons.continueAfterTool,
    'usage.reason.backgroundReview': t.reasons.backgroundReview,
    'usage.reason.sessionCompaction': t.reasons.sessionCompaction,
    'usage.reason.sessionTitle': t.reasons.sessionTitle,
    'usage.reason.imageUnderstanding': t.reasons.imageUnderstanding,
    'usage.reason.webExtract': t.reasons.webExtract,
    'usage.reason.sessionSearch': t.reasons.sessionSearch,
    'usage.reason.noteGeneration': t.reasons.noteGeneration,
    'usage.reason.automationDraft': t.reasons.automationDraft,
    'usage.reason.taskPlanning': t.reasons.taskPlanning,
    'usage.reason.taskJudging': t.reasons.taskJudging,
    'usage.reason.voiceSummary': t.reasons.voiceSummary,
    'usage.reason.voiceSelection': t.reasons.voiceSelection,
    'usage.reason.homeAdvice': t.reasons.homeAdvice,
    'usage.reason.workDiscovery': t.reasons.workDiscovery,
    'usage.reason.workInvestigation': t.reasons.workInvestigation,
    'usage.reason.discussionAnalysis': t.reasons.discussionAnalysis,
    'usage.reason.textAssist': t.reasons.textAssist,
    'usage.reason.userModelInterpretation': t.reasons.userModelInterpretation,
    'usage.reason.other': t.reasons.other,
  };

  return <SettingsPageFrame>
    <SettingsPageHeader
      title={t.title}
      subtitle={t.subtitle}
      actions={<div className="flex items-center gap-2"><div className="w-36">
        <PopoverSelect
          value={days}
          allowEmpty={false}
          ariaLabel={t.periodLabel}
          placeholder={t.periodLabel}
          options={[
            { value: '7', label: t.last7Days },
            { value: '30', label: t.last30Days },
            { value: '90', label: t.last90Days },
          ]}
          onChange={setDays}
        />
      </div><Button variant="ghost" aria-label={t.refresh} title={t.refresh} onClick={() => setDays(days)}>
        <RefreshCw className="size-4" aria-hidden />
      </Button></div>}
    />

    {loading ? <UsageSkeleton /> : error ? (
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-edge bg-surface-inset p-4 text-sm text-fg-muted">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
        <div className="space-y-2">
          <div><p className="font-medium text-fg">{t.loadError}</p><p className="mt-1">{String(error.message ?? error)}</p></div>
          <Button variant="secondary" onClick={() => void Promise.all([summary.mutate(), events.mutate()])}>{t.retry}</Button>
        </div>
      </div>
    ) : totals ? <div className="space-y-5">
      <h2 className="text-sm font-semibold text-fg">{t.summaryLabel}</h2>
      <section aria-label={t.summaryLabel} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: t.cloudCharged, value: cloudAmount(totals), icon: Coins },
          { label: t.knownCost, value: externalAmount(totals), icon: Coins },
          { label: t.calls, value: totals.calls.toLocaleString(), icon: Gauge },
          { label: t.tokens, value: compactNumber(totals.totalTokens, language), icon: Database },
        ].map(item => <div key={item.label} className="rounded-xl border border-edge bg-surface-panel p-4">
          <div className="flex items-center gap-2 text-xs text-fg-muted"><item.icon className="size-4" aria-hidden />{item.label}</div>
          <div className="mt-2 text-xl font-semibold tabular-nums text-fg">{item.value}</div>
        </div>)}
      </section>

      {(totals.billing?.external.unknownCostCalls ?? 0) > 0 ? (
        <p className="rounded-lg border border-edge bg-surface-inset px-3 py-2 text-xs leading-5 text-fg-muted">
          {totals.billing?.external.unknownCostCalls === totals.billing?.external.calls ? t.allCostsUnknown : t.someCostsUnknown}
        </p>
      ) : null}

      {totals.billing?.cloud.calls ? <p className="rounded-lg border border-edge bg-surface-inset px-3 py-2 text-xs leading-5 text-fg-muted">
        {t.cloudCoverage.replace('{{pending}}', String(totals.billing.cloud.pendingCalls))
          .replace('{{unknown}}', String(totals.billing.cloud.unavailableCalls))}
        {totals.billing.cloud.reservedCreditMicro !== null ? ` ${t.cloudReserved.replace('{{credits}}', creditDecimal(totals.billing.cloud.reservedCreditMicro))}` : ''}
      </p> : null}

      <section className="overflow-hidden rounded-xl border border-edge bg-surface-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">{t.distribution}</h2>
            <p className="mt-1 text-xs text-fg-subtle">{t.distributionHint}</p>
          </div>
          <SlidingTabList className="flex gap-1" role="group" aria-label={t.distribution}>
            {(['scenario', 'model'] as const).map(value => <Button key={value} variant={grouping === value ? 'secondary' : 'ghost'} aria-pressed={grouping === value}
              onClick={() => updateParams(next => { next.set('group', value); next.delete('groupPage'); })}>
              {value === 'scenario' ? t.byScenario : t.byModel}
            </Button>)}
          </SlidingTabList>
        </div>
        <div className="divide-y divide-edge-subtle px-4">
          {visibleGroups?.length ? visibleGroups.map(item => {
            const label = grouping === 'scenario' ? t.categories[item.key as keyof typeof t.categories] ?? item.key : item.key;
            return <div key={item.key} className="flex flex-col gap-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg" title={label}>{label}</p>
                <div className="mt-2 h-1 max-w-64 overflow-hidden rounded-full bg-surface-inset" aria-hidden>
                  <div className="h-full rounded-full bg-accent" style={{ width: `${totals.calls ? item.totals.calls / totals.calls * 100 : 0}%` }} />
                </div>
              </div>
              <div className="shrink-0 self-end tabular-nums text-fg-muted sm:self-auto">{breakdown(item.totals)}</div>
            </div>;
          }) : <p className="py-5 text-sm text-fg-subtle">{t.empty}</p>}
        </div>
        {groupPageCount > 1 ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-4 py-3">
          <p className="text-xs text-fg-muted" aria-live="polite">{t.groupPage.replace('{{page}}', String(groupPage)).replace('{{pages}}', String(groupPageCount)).replace('{{count}}', String(groups?.length ?? 0))}</p>
          <div className="flex gap-2">
            <Button disabled={groupPage === 1} aria-label={t.previousDistribution} onClick={() => updateParams(next => next.set('groupPage', String(groupPage - 1)))}>{t.previousPage}</Button>
            <Button disabled={groupPage === groupPageCount} aria-label={t.nextDistribution} onClick={() => updateParams(next => next.set('groupPage', String(groupPage + 1)))}>{t.nextPage}</Button>
          </div>
        </div> : null}
      </section>

      <section className="overflow-hidden rounded-xl border border-edge bg-surface-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
          <div><h2 className="text-sm font-semibold text-fg">{t.recentCalls}</h2>
          <p className="mt-1 text-xs text-fg-subtle">{t.recentCallsHint}</p></div>
          <div className="w-36"><PopoverSelect value={String(pageSize)} allowEmpty={false} ariaLabel={t.pageSize} placeholder={t.pageSize}
            options={[20, 50].map(value => ({ value: String(value), label: t.rowsPerPage.replace('{{count}}', String(value)) }))}
            onChange={value => updateParams(next => { next.set('size', value); next.delete('cursor'); })} /></div>
        </div>
        <div className="divide-y divide-edge-subtle">
          {events.error ? <div role="alert" className="space-y-3 p-4 text-sm text-fg-muted"><p>{t.loadError}</p><Button onClick={() => void events.mutate()}>{t.retry}</Button></div>
          : !events.data ? <div aria-busy="true" className="space-y-3 p-4">{[0, 1, 2, 3].map(value => <Skeleton key={value} className="h-16" />)}</div>
          : events.data.items.length ? events.data.items.map(event => (
            <article key={event.id} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Bot className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                  <span className="truncate font-medium text-fg">{reasonLabels[event.reasonKey] ?? t.reasons.other}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{event.provider}/{event.model}</span>
                  <span className="inline-flex items-center gap-1"><Timer className="size-3" aria-hidden />{dateTime(event.startedAt, language)}</span>
                  <span className="rounded border border-edge px-1.5 py-0.5">{sourceLabel(event)}</span>
                  <span>{event.totalTokens === undefined ? t.tokensUnknown : `${compactNumber(event.totalTokens, language)} tokens`}</span>
                </div>
              </div>
              <div className="text-left tabular-nums text-fg sm:text-right">
                {eventAmount(event)}
                <div className="mt-0.5 text-xs text-fg-subtle">{t.status[event.status as keyof typeof t.status] ?? event.status}</div>
              </div>
            </article>
          )) : <p className="px-4 py-8 text-center text-sm text-fg-subtle">{t.empty}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-4 py-3">
          <p className="text-xs text-fg-muted" aria-live="polite">{t.eventPage.replace('{{page}}', String(page)).replace('{{count}}', String(events.data?.items.length ?? 0))}</p>
          <nav className="flex gap-2" aria-label={t.pagination}>
            {page > 1 ? <Button variant="ghost" onClick={() => updateParams(next => next.delete('cursor'))}>{t.firstPage}</Button> : null}
            <Button disabled={page === 1} onClick={() => updateParams(next => { next.delete('cursor'); cursors.slice(0, -1).forEach(value => next.append('cursor', value)); })}>{t.previousPage}</Button>
            <Button disabled={!events.data?.nextCursor || !!events.error} onClick={() => updateParams(next => { if (events.data?.nextCursor) next.append('cursor', events.data.nextCursor); })}>{t.nextPage}</Button>
          </nav>
        </div>
      </section>
      <details className="rounded-xl border border-edge bg-surface-panel p-4">
        <summary className="cursor-pointer text-sm font-medium text-fg focus-visible:outline-accent">{t.billingDetails}</summary>
        <p className="mt-3 text-xs leading-5 text-fg-muted">{t.cloudBillingHint}</p>
        <a className="mt-2 inline-block text-xs text-accent-fg hover:underline" href="https://console.xopc.ai/models/billing" target="_blank" rel="noreferrer">{t.cloudCreditsLabel}</a>
        {cloudUsed ? <div className="mt-4"><XopcCloudAccountCard labels={messages(language).capabilitiesSettings.xopcCloudAccount} /></div> : null}
      </details>
    </div> : null}
  </SettingsPageFrame>;
}
