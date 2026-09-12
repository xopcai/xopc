import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';

import { proactiveGet, type ProactiveOverview } from './api';
import { ProactiveCardView } from './proactive-card';
import { proactiveCopy } from './copy';

export function ProactiveToday({ compact = false }: { compact?: boolean }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const copy = proactiveCopy(zh);
  const state = useSWR<ProactiveOverview>('/api/proactive/overview', proactiveGet, { refreshInterval: 15000 });
  if (state.isLoading) return <Skeleton className="h-44 rounded-2xl" />;
  if (state.error) return <p role="alert" className="text-sm text-danger">{String(state.error)}</p>;
  const data = state.data;
  if (!data) return null;
  const groups = [[zh ? '需要你决定' : 'Needs your decision', data.needsDecision], [zh ? '已为你准备' : 'Prepared for you', data.prepared], [zh ? '值得知道' : 'Worth knowing', data.updates]] as const;
  const count = data.needsDecision.length + data.prepared.length + data.updates.length;
  return <div className="space-y-6">
    {!count && <div className="rounded-2xl border border-edge p-6"><h2 className="font-medium text-fg">{data.delegations.length ? (zh ? '交代的事情记着，有进展会在这里交付' : 'Your work is tracked. Useful progress will appear here.') : (zh ? '先交给我一件事' : 'Start with one thing')}</h2><p className="mt-2 text-sm text-fg-muted">{zh ? '帮你盯住项目，提前准备材料，跟进到结果。' : 'Follow a project, prepare useful work, and keep track of the outcome.'}</p><Link className="mt-3 inline-block text-sm text-accent" to="/proactive?tab=services">{zh ? '看看能帮什么' : 'Explore services'}</Link></div>}
    {groups.map(([title, cards]) => cards.length ? <section key={title}><h2 className="mb-3 text-sm font-medium text-fg-muted">{title}</h2><div className="space-y-3">{(compact ? cards.slice(0, 2) : cards).map(card => <ProactiveCardView key={card.id} card={card} copy={copy} refresh={() => void state.mutate()} />)}</div>{compact && cards.length > 2 && <Link className="mt-2 block text-sm text-accent" to="/proactive">{zh ? `查看其余 ${cards.length - 2} 项` : `View ${cards.length - 2} more`}</Link>}</section> : null)}
    {compact && <Link className="inline-block text-sm text-accent" to="/proactive?tab=delegations">{zh ? '交给我的事' : 'Delegated work'} · {data.delegations.length}</Link>}
  </div>;
}
