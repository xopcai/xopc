import type { ProactiveCard } from '@xopcai/gateway-contract';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';

import { proactiveGet, proactiveWrite, type CardsResponse, type PreferencesResponse, type ProactiveOverview } from './api';
import { BrowserPushControls } from './browser-push';
import { proactiveCopy } from './copy';
import { DelegationServices, DelegationView } from './delegations';
import { MailFollowUpView } from './mail-follow-ups';
import { ProactiveCardView } from './proactive-card';
import { ProactivePreferencesForm } from './proactive-settings';
import { ProactiveToday } from './proactive-today';

export function ProactivePage() {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const copy = proactiveCopy(zh);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'today';
  const itemId = params.get('item');
  const digestId = params.get('digest');
  const preferences = useSWR<PreferencesResponse>('/api/proactive/preferences', proactiveGet);
  const overview = useSWR<ProactiveOverview>(tab === 'delegations' ? '/api/proactive/overview' : null, proactiveGet, { refreshInterval: 15000 });
  const detail = useSWR<{ card: ProactiveCard }>(itemId ? `/api/inbox/judgments/${encodeURIComponent(itemId)}` : null, proactiveGet, { revalidateOnFocus: false });
  const digest = useSWR<CardsResponse>(digestId ? `/api/proactive/digests/${encodeURIComponent(digestId)}` : null, proactiveGet);
  const probeId = params.get('probe');
  useEffect(() => { if (probeId) void proactiveWrite(`/api/proactive/web-push/probes/${encodeURIComponent(probeId)}/opened`, 'POST', {}).catch(() => {}); }, [probeId]);
  const error = detail.error ?? overview.error ?? preferences.error ?? digest.error;
  const loading = detail.isLoading || overview.isLoading || preferences.isLoading || digest.isLoading;
  return <div className="min-h-0 flex-1 overflow-y-auto bg-surface-base"><div className="mx-auto max-w-4xl space-y-6 px-4 py-7 sm:px-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold text-fg">{zh ? '助理在跟进' : 'Your assistant at work'}</h1><p className="mt-2 text-sm text-fg-muted">{zh ? '记住交代的事，准备好成果，跟进到结果。' : 'Remember your priorities, prepare useful work, and follow through.'}</p></div><Button variant="ghost" onClick={() => setParams({ tab: 'settings' })}>{preferences.data ? copy.levels[preferences.data.preferences.level] : copy.settings}</Button></header>
    <nav className="flex flex-wrap gap-2" aria-label={zh ? '助理工作' : 'Assistant work'}>{[['today', zh ? '今天' : 'Today'], ['delegations', zh ? '交给我的事' : 'Delegated work'], ['services', zh ? '交代一件事' : 'Delegate something']].map(([id, title]) => <Button key={id} variant={tab === id && !itemId ? 'secondary' : 'ghost'} onClick={() => setParams({ tab: id })}>{title}</Button>)}</nav>
    {error && <p role="alert" className="text-sm text-danger">{String(error)}</p>}
    {loading ? <Skeleton className="h-64 rounded-2xl" /> : itemId ? <><Link className="text-sm text-accent" to="/proactive">{zh ? '返回今天' : 'Back to today'}</Link>{detail.data && <ProactiveCardView key={`${detail.data.card.id}:${detail.data.card.revision}`} card={detail.data.card} copy={copy} refresh={() => void detail.mutate()} detail />}</> : digestId ? <><h2 className="font-medium">{zh ? '为你整理的变化' : 'Your work update'}</h2>{digest.data?.cards.map(card => <ProactiveCardView key={card.id} card={card} copy={copy} refresh={() => void digest.mutate()} />)}{digest.data?.cards.length === 0 && <p className="text-sm text-fg-muted">{zh ? '这些事项已处理或不再需要关注。' : 'These items have been handled or are no longer relevant.'}</p>}</> : tab === 'settings' && preferences.data ? <><ProactivePreferencesForm key={preferences.data.preferences.revision} preferences={preferences.data.preferences} copy={copy} refresh={() => void preferences.mutate()} /><BrowserPushControls zh={zh} /></> : tab === 'services' ? <DelegationServices zh={zh} projectId={params.get('project') ?? undefined} onStarted={() => setParams({ tab: 'delegations' })} /> : tab === 'delegations' ? <div className="space-y-4">{overview.data?.delegations.map(sub => <DelegationView key={`${sub.id}:${sub.revision}`} sub={sub} zh={zh} refresh={() => void overview.mutate()} />)}{overview.data?.followUps.map(follow => <MailFollowUpView key={`${follow.id}:${follow.revision}`} follow={follow} zh={zh} refresh={() => void overview.mutate()} />)}{overview.data?.delegations.length === 0 && <Link className="text-sm text-accent" to="/proactive?tab=services">{zh ? '先交给我一件事' : 'Start with one thing'}</Link>}</div> : <ProactiveToday />}
  </div></div>;
}
