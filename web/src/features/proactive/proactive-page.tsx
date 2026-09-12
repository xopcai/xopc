import type { ProactiveCard } from '@xopcai/gateway-contract';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';

import { ProactiveStatistics } from './delivery-controls';
import { proactiveWrite } from './api';
import { BrowserPushControls } from './browser-push';
import { proactiveGet, type CardsResponse, type PreferencesResponse, type ProactiveSubscription, type ProactiveTemplate } from './api';
import { proactiveCopy } from './copy';
import { ProactiveCardView } from './proactive-card';
import { ProactivePreferencesForm, SubscriptionForm } from './proactive-settings';

export function ProactivePage() {
  const language = useLocaleStore((state) => state.language);
  const copy = proactiveCopy(language === 'zh');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'cards';
  const itemId = params.get('item');
  const digestId = params.get('digest');
  const probeId = params.get('probe');
  const [presenceId] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState('');
  const [before, setBefore] = useState('');
  const preferences = useSWR<PreferencesResponse>('/api/proactive/preferences', proactiveGet);
  const templates = useSWR<{ templates: ProactiveTemplate[] }>(tab === 'templates' ? '/api/proactive/templates' : null, proactiveGet);
  const subscriptions = useSWR<{ subscriptions: ProactiveSubscription[] }>(tab === 'templates' ? '/api/proactive/subscriptions' : null, proactiveGet);
  const projects = useSWR<{ items: Array<{ id: string; name: string }> }>(tab === 'templates' ? '/api/projects?limit=200' : null, proactiveGet);
  const cards = useSWR<CardsResponse>(tab === 'cards' && !itemId && !digestId ? `/api/proactive/cards?status=${status}&before=${encodeURIComponent(before)}` : null, proactiveGet, { refreshInterval: 15000 });
  const digest = useSWR<CardsResponse>(digestId ? `/api/proactive/digests/${encodeURIComponent(digestId)}` : null, proactiveGet, { refreshInterval: 15000 });
  useEffect(() => {
    if (probeId) void proactiveWrite(`/api/proactive/web-push/probes/${encodeURIComponent(probeId)}/opened`, 'POST', {}).catch(() => {});
  }, [probeId]);
  useEffect(() => {
    const active = tab === 'cards';
    const heartbeat = () => { void proactiveWrite('/api/proactive/presence', 'POST', { clientId: presenceId, surface: 'web', active: active && document.visibilityState === 'visible' && document.hasFocus() }).catch(() => {}); };
    heartbeat();
    const timer = window.setInterval(heartbeat, 30000);
    document.addEventListener('visibilitychange', heartbeat); window.addEventListener('focus', heartbeat); window.addEventListener('blur', heartbeat);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', heartbeat); window.removeEventListener('focus', heartbeat); window.removeEventListener('blur', heartbeat); void proactiveWrite('/api/proactive/presence', 'POST', { clientId: presenceId, surface: 'web', active: false }).catch(() => {}); };
  }, [presenceId, tab]);
  const detail = useSWR<{ card: ProactiveCard }>(itemId ? `/api/inbox/judgments/${encodeURIComponent(itemId)}` : null, proactiveGet, { refreshInterval: 15000 });
  const refresh = () => { void cards.mutate(); void detail.mutate(); void digest.mutate(); void subscriptions.mutate(); };
  useEffect(() => {
    const changed = () => { void cards.mutate(); void detail.mutate(); };
    window.addEventListener('proactive-card-changed', changed);
    return () => window.removeEventListener('proactive-card-changed', changed);
  }, [cards.mutate, detail.mutate]);
  const error = digest.error ?? preferences.error ?? cards.error ?? detail.error ?? templates.error ?? subscriptions.error ?? projects.error;
  const loading = digest.isLoading || preferences.isLoading || cards.isLoading || detail.isLoading || templates.isLoading || subscriptions.isLoading || projects.isLoading;
  return <div className="min-h-0 flex-1 overflow-y-auto bg-surface-base"><div className="mx-auto max-w-5xl space-y-6 px-4 py-7 sm:px-6">
    <header><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold text-fg">{copy.title}</h1><Button variant="ghost" onClick={() => setParams({ tab: 'settings' })}>{copy.level}: {preferences.data ? copy.levels[preferences.data.preferences.level] : '…'}</Button></div><p className="mt-2 text-sm text-fg-muted">{copy.subtitle}</p></header>
    <nav className="flex gap-2" aria-label={copy.title}>{(['cards', 'templates', 'settings'] as const).map((value) => <Button key={value} variant={tab === value && !itemId ? 'primary' : 'ghost'} onClick={() => setParams(value === 'cards' ? {} : { tab: value })}>{copy[value]}</Button>)}</nav>
    {error && <div role="alert" className="rounded-xl border border-edge p-4 text-sm text-danger">{error instanceof Error ? error.message : String(error)}<Button className="ml-3" onClick={() => { refresh(); void preferences.mutate(); void templates.mutate(); void projects.mutate(); }}>{copy.retry}</Button></div>}
    {loading ? <div aria-busy className="space-y-4">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-44 rounded-2xl" />)}</div> : digestId ? <><h2 className="font-medium">{language === 'zh' ? '工作摘要' : 'Work digest'}</h2>{digest.data?.cards.length === 0 && <p className="text-sm text-fg-muted">{language === 'zh' ? '这份摘要中的事项已处理、过期或撤回。' : 'Items in this digest are resolved, expired, or withdrawn.'}</p>}{digest.data?.cards.map((card) => <ProactiveCardView key={card.id} card={card} copy={copy} refresh={refresh} />)}</> : itemId ? <><Link className="text-sm text-accent" to="/proactive">{copy.close}</Link>{detail.data && <ProactiveCardView card={detail.data.card} copy={copy} refresh={refresh} detail />}</> : tab === 'settings' && preferences.data ? <><ProactivePreferencesForm key={preferences.data.preferences.revision} preferences={preferences.data.preferences} copy={copy} refresh={() => void preferences.mutate()} /><BrowserPushControls zh={language === 'zh'} /><ProactiveStatistics zh={language === 'zh'} /></> : tab === 'templates' ? <div className="grid items-start gap-4 lg:grid-cols-2">{templates.data?.templates.flatMap((template) => {
      const matches = subscriptions.data?.subscriptions.filter((sub) => sub.scenarioKey === template.key) ?? [];
      return [...matches.map((sub) => <SubscriptionForm key={`${sub.id}:${sub.revision}`} template={template} subscription={sub} projects={projects.data?.items ?? []} copy={copy} refresh={refresh} />), ...(matches.length === 0 || template.scopeKind === 'project' ? [<SubscriptionForm key={`new:${template.key}`} template={template} projects={(projects.data?.items ?? []).filter((project) => !matches.some((sub) => sub.scopeId === project.id))} copy={copy} refresh={refresh} />] : [])];
    })}</div> : <>
      <div className="flex gap-2">{[['', copy.all], ['unread', copy.unread], ['resolved', copy.resolved]].map(([value, label]) => <Button key={value} variant={status === value ? 'secondary' : 'ghost'} onClick={() => { setStatus(value); setBefore(''); }}>{label}</Button>)}</div>
      {cards.data?.cards.length === 0 && <div className="rounded-2xl border border-edge p-10 text-center text-sm text-fg-muted">{copy.empty}<Link className="mt-3 block text-accent" to="/proactive?tab=templates">{copy.templates}</Link></div>}
      <div className="space-y-4">{cards.data?.cards.map((card) => <ProactiveCardView key={card.id} card={card} copy={copy} refresh={refresh} />)}</div>
      <div className="flex gap-2">{before && <Button onClick={() => setBefore('')}>{copy.first}</Button>}{cards.data?.nextCursor && <Button onClick={() => setBefore(cards.data!.nextCursor!)}>{copy.more}</Button>}</div>
    </>}
  </div></div>;
}
