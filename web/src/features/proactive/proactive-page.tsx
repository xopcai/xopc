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
import { DelegationDetail, DelegationListItem, DelegationServices } from './delegations';
import { MailFollowUpListItem, MailFollowUpView } from './mail-follow-ups';
import { delegationBucket, latestCardFor, mailFollowUpBucket, type DelegationBucket } from './presentation';
import { ProactiveCardView } from './proactive-card';
import { ProactivePreferencesForm } from './proactive-settings';

export function ProactivePage() {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const copy = proactiveCopy(zh);
  const [params, setParams] = useSearchParams();
  const requestedView = params.get('view');
  const view = requestedView === 'new' || requestedView === 'settings' ? requestedView : 'list';
  const requestedBucket = params.get('state');
  const bucket: DelegationBucket = requestedBucket === 'paused' || requestedBucket === 'completed' ? requestedBucket : 'active';
  const itemId = params.get('item');
  const digestId = params.get('digest');
  const delegationId = params.get('delegation');
  const followUpId = params.get('follow-up');
  const needsOverview = view === 'list' || Boolean(delegationId || followUpId);
  const preferences = useSWR<PreferencesResponse>(view === 'settings' ? '/api/proactive/preferences' : null, proactiveGet);
  const overview = useSWR<ProactiveOverview>(needsOverview ? '/api/proactive/overview' : null, proactiveGet, { refreshInterval: 15000 });
  const detail = useSWR<{ card: ProactiveCard }>(itemId ? `/api/inbox/judgments/${encodeURIComponent(itemId)}` : null, proactiveGet, { revalidateOnFocus: false });
  const digest = useSWR<CardsResponse>(digestId ? `/api/proactive/digests/${encodeURIComponent(digestId)}` : null, proactiveGet);
  const probeId = params.get('probe');
  useEffect(() => { if (probeId) void proactiveWrite(`/api/proactive/web-push/probes/${encodeURIComponent(probeId)}/opened`, 'POST', {}).catch(() => {}); }, [probeId]);

  const error = detail.error ?? overview.error ?? preferences.error ?? digest.error;
  const loading = detail.isLoading || overview.isLoading || preferences.isLoading || digest.isLoading;
  const cards = overview.data ? [...overview.data.needsDecision, ...overview.data.prepared, ...overview.data.updates] : [];
  const delegations = overview.data?.delegations.filter(sub => sub.scenarioKey !== 'communication_follow_up') ?? [];
  const visibleDelegations = delegations.filter(sub => delegationBucket(sub) === bucket);
  const visibleFollowUps = overview.data?.followUps.filter(follow => mailFollowUpBucket(follow) === bucket) ?? [];
  const selectedDelegation = delegations.find(sub => sub.id === delegationId);
  const selectedFollowUp = overview.data?.followUps.find(follow => follow.id === followUpId);
  const updateParams = (values: Record<string, string>) => setParams(values);

  if (loading) return <div className="min-h-0 flex-1 overflow-y-auto bg-surface-base"><div className="mx-auto max-w-4xl space-y-5 px-4 py-7 sm:px-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-56 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /></div></div>;
  return <div className="min-h-0 flex-1 overflow-y-auto bg-surface-base"><div className="mx-auto max-w-4xl space-y-6 px-4 py-7 sm:px-6">
    {error && <p role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">{String(error)}</p>}
    {itemId ? <><Link className="text-sm text-accent" to="/">{zh ? '返回工作台' : 'Back to Workbench'}</Link>{detail.data && <ProactiveCardView key={`${detail.data.card.id}:${detail.data.card.revision}`} card={detail.data.card} copy={copy} refresh={() => void detail.mutate()} detail />}</>
      : digestId ? <><Link className="text-sm text-accent" to="/">{zh ? '返回工作台' : 'Back to Workbench'}</Link><h1 className="text-2xl font-semibold text-fg">{zh ? '助理为你整理的变化' : 'Updates prepared by your assistant'}</h1>{digest.data?.cards.map(card => <ProactiveCardView key={card.id} card={card} copy={copy} refresh={() => void digest.mutate()} />)}{digest.data?.cards.length === 0 && <p className="text-sm text-fg-muted">{zh ? '这些事项已处理或不再需要关注。' : 'These items have been handled or are no longer relevant.'}</p>}</>
      : selectedDelegation ? <><Link className="text-sm text-accent" to="/assistant-work">{zh ? '返回交给我的事' : 'Back to delegated work'}</Link><DelegationDetail key={selectedDelegation.id} sub={selectedDelegation} card={latestCardFor(cards, selectedDelegation.id)} zh={zh} refresh={() => void overview.mutate()} /></>
      : selectedFollowUp ? <><Link className="text-sm text-accent" to="/assistant-work">{zh ? '返回交给我的事' : 'Back to delegated work'}</Link><MailFollowUpView follow={selectedFollowUp} zh={zh} refresh={() => void overview.mutate()} /></>
      : <><header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold text-fg">{view === 'new' ? (zh ? '交代一件事' : 'Delegate something') : view === 'settings' ? (zh ? '助理提醒' : 'Assistant notifications') : (zh ? '交给我的事' : 'Delegated work')}</h1><p className="mt-2 text-sm text-fg-muted">{view === 'new' ? (zh ? '说清目标，助理会记住并持续跟进。' : 'Describe the goal and your assistant will follow it through.') : view === 'settings' ? (zh ? '决定助理什么时候提醒你，以及通过什么方式送达。' : 'Choose when and how your assistant should notify you.') : (zh ? '查看助理记住的事项、当前进展和下一步。' : 'Review remembered work, current progress, and what happens next.')}</p></div><div className="flex gap-2">{view !== 'list' && <Button variant="ghost" onClick={() => updateParams({})}>{zh ? '返回列表' : 'Back to list'}</Button>}{view === 'list' && <><Button variant="ghost" onClick={() => updateParams({ view: 'settings' })}>{zh ? '助理提醒' : 'Notifications'}</Button><Button variant="primary" onClick={() => updateParams({ view: 'new' })}>{zh ? '交代一件事' : 'Delegate something'}</Button></>}</div></header>
        {view === 'settings' && preferences.data ? <div className="space-y-5"><ProactivePreferencesForm key={preferences.data.preferences.revision} preferences={preferences.data.preferences} copy={copy} refresh={() => void preferences.mutate()} /><BrowserPushControls zh={zh} /></div>
          : view === 'new' ? <DelegationServices zh={zh} projectId={params.get('project') ?? undefined} onStarted={() => updateParams({})} />
          : <div className="space-y-5"><nav className="flex gap-2" aria-label={zh ? '事项状态' : 'Work status'}>{([['active', zh ? '进行中' : 'Active'], ['paused', zh ? '已暂停' : 'Paused'], ['completed', zh ? '已结束' : 'Ended']] as const).map(([id, label]) => <Button key={id} variant={bucket === id ? 'secondary' : 'ghost'} onClick={() => updateParams(id === 'active' ? {} : { state: id })}>{label}</Button>)}</nav><div className="space-y-3">{visibleDelegations.map(sub => <DelegationListItem key={`${sub.id}:${sub.revision}`} sub={sub} card={latestCardFor(cards, sub.id)} zh={zh} />)}{visibleFollowUps.map(follow => <MailFollowUpListItem key={`${follow.id}:${follow.revision}`} follow={follow} zh={zh} />)}{visibleDelegations.length + visibleFollowUps.length === 0 && <section className="rounded-2xl border border-edge bg-surface-panel p-6"><h2 className="font-medium text-fg">{bucket === 'active' ? (zh ? '还没有进行中的事项' : 'No active delegated work') : bucket === 'paused' ? (zh ? '没有已暂停的事项' : 'No paused work') : (zh ? '没有已结束的事项' : 'No ended work')}</h2>{bucket === 'active' && <Button className="mt-3" variant="primary" onClick={() => updateParams({ view: 'new' })}>{zh ? '交代第一件事' : 'Delegate your first task'}</Button>}</section>}</div></div>}
      </>}
  </div></div>;
}
