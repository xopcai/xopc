import type { UsageTotals, UsageEvent } from '@xopcai/gateway-contract';
import { AlertCircle, Bot, Coins, Database, Gauge, Timer } from 'lucide-react';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

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
  const [days, setDays] = useState('7');
  const query = useMemo(() => usageQuery(Number(days)), [days]);
  const summary = useSWR(['usage-summary', query], () => getUsageSummary(query), { refreshInterval: 15_000 });
  const events = useSWR(['usage-events', query], () => getUsageEvents(query), { refreshInterval: 15_000 });
  const loading = (!summary.data && !summary.error) || (!events.data && !events.error);
  const error = summary.error ?? events.error;
  const totals = summary.data?.totals;
  const cloudUsed = summary.data?.byModel.some(item => item.provider === 'xopc-cloud')
    || events.data?.items.some(item => item.provider === 'xopc-cloud');

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
    'usage.reason.sceneExecution': t.reasons.sceneExecution,
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
      actions={<div className="w-36">
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
      </div>}
    />

    {cloudUsed ? <div className="mb-4"><XopcCloudAccountCard labels={messages(language).capabilitiesSettings.xopcCloudAccount} /></div> : null}
    <p className="mb-4 text-xs text-fg-subtle">{t.cloudBillingHint}</p>
    {loading ? <UsageSkeleton /> : error ? (
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-edge bg-surface-inset p-4 text-sm text-fg-muted">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
        <div className="space-y-2">
          <div><p className="font-medium text-fg">{t.loadError}</p><p className="mt-1">{String(error.message ?? error)}</p></div>
          <Button variant="secondary" onClick={() => void Promise.all([summary.mutate(), events.mutate()])}>{t.retry}</Button>
        </div>
      </div>
    ) : totals ? <>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-edge bg-surface-panel p-4">
          <h2 className="text-sm font-semibold text-fg">{t.byScenario}</h2>
          <div className="mt-3 divide-y divide-edge-subtle">
            {summary.data?.byCategory.length ? summary.data.byCategory.map(item => (
              <div key={item.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0 truncate text-fg-muted" title={t.categories[item.key as keyof typeof t.categories] ?? item.key}>{t.categories[item.key as keyof typeof t.categories] ?? item.key}</span>
                <span className="shrink-0 tabular-nums text-fg">{breakdown(item.totals)}</span>
              </div>
            )) : <p className="py-5 text-sm text-fg-subtle">{t.empty}</p>}
          </div>
        </section>
        <section className="rounded-xl border border-edge bg-surface-panel p-4">
          <h2 className="text-sm font-semibold text-fg">{t.byModel}</h2>
          <div className="mt-3 divide-y divide-edge-subtle">
            {summary.data?.byModel.length ? summary.data.byModel.map(item => (
              <div key={item.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0 truncate text-fg-muted" title={item.key}>{item.key}</span>
                <span className="shrink-0 tabular-nums text-fg">{breakdown(item.totals)}</span>
              </div>
            )) : <p className="py-5 text-sm text-fg-subtle">{t.empty}</p>}
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-edge bg-surface-panel">
        <div className="border-b border-edge px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">{t.recentCalls}</h2>
          <p className="mt-1 text-xs text-fg-subtle">{t.recentCallsHint}</p>
        </div>
        <div className="divide-y divide-edge-subtle">
          {events.data?.items.length ? events.data.items.map(event => (
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
                {event.billing?.source === 'xopc_cloud' ? <a className="mt-1 block text-xs text-accent-fg hover:underline" href="https://console.xopc.ai/models/billing" target="_blank" rel="noreferrer">{t.cloudCreditsLabel}</a> : null}
                <div className="mt-0.5 text-xs text-fg-subtle">{t.status[event.status as keyof typeof t.status] ?? event.status}</div>
              </div>
            </article>
          )) : <p className="px-4 py-8 text-center text-sm text-fg-subtle">{t.empty}</p>}
        </div>
      </section>
    </> : null}
  </SettingsPageFrame>;
}
