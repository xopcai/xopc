import type { ProactivePreferences } from '@xopcai/gateway-contract';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';

import { DeliverySettings } from './delivery-controls';
import { SubscriptionPreview, WorkflowChoice } from './preview';
import { proactiveGet, proactiveWrite, type ProactiveSubscription, type ProactiveTemplate } from './api';
import { localizedTemplate, runLabel, type ProactiveCopy } from './copy';

const inputClass = 'mt-1 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg';

export function ProactivePreferencesForm({ preferences, copy, refresh }: { preferences: ProactivePreferences; copy: ProactiveCopy; refresh: () => void }) {
  const [draft, setDraft] = useState(preferences);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(patch: Partial<ProactivePreferences> = draft) {
    setBusy(true); setMessage('');
    try {
      const { revision: _revision, ...values } = { ...draft, ...patch };
      await proactiveWrite('/api/proactive/preferences', 'PATCH', { ...values, expectedRevision: preferences.revision });
      setMessage(copy.saved); refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <form className="max-w-2xl space-y-5 rounded-2xl border border-edge bg-surface-panel p-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <label className="block text-sm">{copy.level}<Select value={draft.level} onChange={(event) => setDraft({ ...draft, level: event.target.value as ProactivePreferences['level'] })}>{Object.entries(copy.levels).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm">{copy.timezone}<input required className={inputClass} value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} /></label>
      <label className="text-sm">{copy.limit}<input required type="number" min={0} max={30} className={inputClass} value={draft.dailyNotificationLimit} onChange={(e) => setDraft({ ...draft, dailyNotificationLimit: Number(e.target.value) })} /></label>
      <label className="text-sm">{copy.quietStart}<input required type="number" min={0} max={23} className={inputClass} value={draft.quietStartHour} onChange={(e) => setDraft({ ...draft, quietStartHour: Number(e.target.value) })} /></label>
      <label className="text-sm">{copy.quietEnd}<input required type="number" min={0} max={23} className={inputClass} value={draft.quietEndHour} onChange={(e) => setDraft({ ...draft, quietEndHour: Number(e.target.value) })} /></label>
    </div>
    <DeliverySettings value={draft} onChange={setDraft} zh={copy.locale === 'zh'} />
    <p className="text-sm text-fg-muted">{copy.privacy}</p>
    <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" disabled={busy}>{copy.save}</Button><Button disabled={busy} onClick={() => void save({ pausedUntil: new Date(Date.now() + 3600000).toISOString() })}>{copy.pause}</Button>{preferences.pausedUntil && <Button disabled={busy} onClick={() => void save({ pausedUntil: null })}>{copy.resume}</Button>}</div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>;
}

export function SubscriptionForm({ template, subscription, projects, copy, refresh }: { template: ProactiveTemplate; subscription?: ProactiveSubscription; projects: Array<{ id: string; name: string }>; copy: ProactiveCopy; refresh: () => void }) {
  const display = localizedTemplate(template.key, template, copy.locale);
  const [level, setLevel] = useState(subscription?.level ?? 'inherit');
  const [delivery, setDelivery] = useState(subscription?.delivery ?? 'important');
  const [scopeId, setScopeId] = useState(subscription?.scopeId ?? '');
  const [instructions, setInstructions] = useState(subscription?.userInstructions ?? '');
  const [workflow, setWorkflow] = useState(subscription?.preparationWorkflowId ?? '');
  const [interval, setInterval] = useState(subscription?.scanIntervalMinutes?.toString() ?? '');
  const [enabled, setEnabled] = useState(subscription?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    setBusy(true); setMessage('');
    const values = { preparationWorkflowId: workflow || null, level: level === 'inherit' ? null : level, delivery, userInstructions: instructions, scanIntervalMinutes: interval ? Number(interval) : null, enabled };
    try {
      if (subscription) await proactiveWrite(`/api/proactive/subscriptions/${encodeURIComponent(subscription.id)}`, 'PATCH', { ...values, expectedRevision: subscription.revision });
      else await proactiveWrite('/api/proactive/subscriptions', 'POST', { ...values, scenarioKey: template.key, scopeKind: template.scopeKind, scopeId: template.scopeKind === 'workspace' ? 'current' : scopeId });
      setMessage(copy.saved); refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4 rounded-2xl border border-edge bg-surface-panel p-5">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{display.title}</h2><p className="mt-1 text-sm text-fg-muted">{display.description}</p></div>{subscription && <span className="shrink-0 text-xs text-fg-muted">{subscription.enabled ? copy.enabled : copy.paused}</span>}</div>
    {template.scopeKind === 'project' && <label className="block text-sm">{copy.scope}<Select value={scopeId} disabled={Boolean(subscription)} onChange={(e) => setScopeId(e.target.value)}><SelectOption value="">{copy.chooseProject}</SelectOption>{projects.map((project) => <SelectOption key={project.id} value={project.id}>{project.name}</SelectOption>)}</Select></label>}
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{copy.level}<Select value={level} onChange={(e) => setLevel(e.target.value)}><SelectOption value="inherit">{copy.inherit}</SelectOption>{Object.entries(copy.levels).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></label><label className="text-sm">{copy.delivery}<Select value={delivery} onChange={(e) => setDelivery(e.target.value as 'important' | 'inbox' | 'digest')}><SelectOption value="important">{copy.important}</SelectOption><SelectOption value="inbox">{copy.inbox}</SelectOption><SelectOption value="digest">{copy.locale === 'zh' ? '每日摘要' : 'Daily digest'}</SelectOption></Select></label></div>
    <label className="block text-sm">{copy.instructions}<textarea maxLength={12000} rows={3} className={inputClass} value={instructions} placeholder={copy.instructionsHint} onChange={(e) => setInstructions(e.target.value)} /></label>
    {template.scheduled && !template.requiresCalendar && <label className="block text-sm">{copy.interval}<input type="number" min={15} max={10080} className={inputClass} value={interval} onChange={(e) => setInterval(e.target.value)} /></label>}
    <p className="text-xs text-fg-muted">{template.requiresCalendar ? `${copy.connection} ${copy.meetingWindows}` : !template.scheduled ? copy.eventOnly : ''}</p>
    {template.calendarSource && <p className="text-xs text-fg-muted">{template.calendarSource.status === 'available' ? `${copy.locale === 'zh' ? '来源数据最近同步' : 'Source data last synced'}: ${template.calendarSource.lastSyncedAt ? new Date(template.calendarSource.lastSyncedAt).toLocaleString() : '—'}` : copy.locale === 'zh' ? '等待已授权的日历数据；请在连接器设置中连接日历并允许主动分析。' : 'Waiting for authorized calendar data. Connect a calendar and allow proactive analysis in connector settings.'}</p>}
    {subscription?.schedule?.lastCheckedAt && <p className="text-xs text-fg-muted">{copy.lastCheck}: {new Date(subscription.schedule.lastCheckedAt).toLocaleString()}</p>}
    <WorkflowChoice value={workflow} onChange={setWorkflow} zh={copy.locale === 'zh'} />
    <div className="flex items-center gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{copy.enable}</label><Button type="submit" variant="primary" disabled={busy || (template.scopeKind === 'project' && !scopeId)}>{copy.save}</Button></div>
    {subscription && <SubscriptionPreview subscriptionId={subscription.id} zh={copy.locale === 'zh'} />}
    {subscription && <RunHistory subscriptionId={subscription.id} copy={copy} />}
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>;
}

function RunHistory({ subscriptionId, copy }: { subscriptionId: string; copy: ProactiveCopy }) {
  const [open, setOpen] = useState(false);
  const result = useSWR<{ runs: Array<{ id: string; status: string; reason: string | null; startedAt: string | null; completedAt: string | null; error: string | null }> }>(open ? `/api/proactive/subscriptions/${encodeURIComponent(subscriptionId)}/runs` : null, proactiveGet, { refreshInterval: 15000 });
  return <details className="border-t border-edge pt-3 text-sm" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-fg-muted">{copy.runs}</summary>
    {result.isLoading ? <Skeleton className="mt-3 h-20" /> : result.error ? <p role="alert" className="mt-3 text-danger">{String(result.error)}</p> : <ul className="mt-3 space-y-3">{result.data?.runs.length === 0 && <li className="text-fg-muted">{copy.noRuns}</li>}{result.data?.runs.map((run) => <li key={run.id}><p>{runLabel(run.status, copy.locale)}{run.reason && ` · ${runLabel(run.reason, copy.locale)}`}</p><p className="text-xs text-fg-muted">{run.startedAt && new Date(run.startedAt).toLocaleString()}{run.error && ` · ${run.error}`}</p></li>)}</ul>}
  </details>;
}
