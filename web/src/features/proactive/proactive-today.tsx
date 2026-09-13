import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';

import { proactiveGet, type ProactiveOverview } from './api';
import { ProactiveCardView } from './proactive-card';
import { proactiveCopy } from './copy';
import { delegationState, delegationTitle, mailFollowUpState } from './presentation';

export function ProactiveToday({ compact = false, section = 'all' }: { compact?: boolean; section?: 'all' | 'decisions' | 'rest' }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const copy = proactiveCopy(zh);
  const state = useSWR<ProactiveOverview>('/api/proactive/overview', proactiveGet, { refreshInterval: 15000 });
  if (state.isLoading) return <Skeleton className="h-44 rounded-2xl" />;
  if (state.error) return <p role="alert" className="text-sm text-danger">{String(state.error)}</p>;
  const data = state.data;
  if (!data) return null;
  const groups = [[zh ? '需要你决定' : 'Needs your decision', data.needsDecision], [zh ? '已为你准备' : 'Prepared for you', data.prepared], [zh ? '值得知道' : 'Worth knowing', data.updates]] as const;
  const visibleGroups = section === 'decisions' ? groups.slice(0, 1) : section === 'rest' ? groups.slice(1) : groups;
  const count = data.needsDecision.length + data.prepared.length + data.updates.length;
  const activeDelegations = data.delegations.filter(sub => sub.scenarioKey !== 'communication_follow_up' && sub.effectiveEnabled && !sub.completedAt);
  const activeFollowUps = data.followUps.filter(follow => follow.status === 'watching' && follow.enabled);
  const tracking = [
    ...activeDelegations.map(sub => ({ id: sub.id, title: delegationTitle(sub, zh), state: delegationState(sub, zh), href: `/assistant-work?delegation=${encodeURIComponent(sub.id)}` })),
    ...activeFollowUps.map(follow => ({ id: follow.id, title: follow.subject ?? (zh ? '邮件跟进' : 'Email follow-up'), state: mailFollowUpState(follow, zh), href: `/assistant-work?follow-up=${encodeURIComponent(follow.id)}` })),
  ];
  return <div className="space-y-6">
    {section !== 'decisions' && !count && !tracking.length && <div className="rounded-2xl border border-edge p-6"><h2 className="font-medium text-fg">{zh ? '今天没有需要处理的新变化' : 'No new changes need attention today'}</h2><p className="mt-2 text-sm text-fg-muted">{zh ? '你可以交代一件需要助理持续跟进的事。' : 'You can delegate something that needs ongoing follow-up.'}</p><Link className="mt-3 inline-block text-sm text-accent" to="/assistant-work?view=new">{zh ? '交代一件事' : 'Delegate something'}</Link></div>}
    {visibleGroups.map(([title, cards]) => cards.length ? <section key={title}><h2 className="mb-3 text-sm font-medium text-fg-muted">{title}</h2><div className="space-y-3">{(compact ? cards.slice(0, 2) : cards).map(card => <ProactiveCardView key={card.id} card={card} copy={copy} refresh={() => void state.mutate()} />)}</div>{compact && cards.length > 2 && <Link className="mt-2 block text-sm text-accent" to="/assistant-work">{zh ? `查看其余 ${cards.length - 2} 项` : `View ${cards.length - 2} more`}</Link>}</section> : null)}
    {section !== 'decisions' && tracking.length > 0 && <section><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-medium text-fg-muted">{zh ? '助理正在跟进' : 'Your assistant is following'}</h2><Link className="text-sm text-accent" to="/assistant-work">{zh ? '查看全部' : 'View all'}</Link></div><div className="divide-y divide-edge-subtle rounded-2xl border border-edge bg-surface-panel">{tracking.slice(0, 2).map(item => <Link key={item.id} className="block px-5 py-4 hover:bg-surface-hover" to={item.href}><span className="font-medium text-fg">{item.title}</span><span className="mt-1 block text-sm text-fg-muted">{item.state}</span></Link>)}</div></section>}
  </div>;
}
