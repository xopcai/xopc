import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';

import { proactiveGet, type ProactiveOverview } from './api';
import { SceneMoment } from './scene-moment';

export function ProactiveToday({ compact = false }: { compact?: boolean }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const state = useSWR<ProactiveOverview>('/api/proactive/overview', proactiveGet, { refreshInterval: 15000 });
  if (state.isLoading) return <Skeleton className="h-44 rounded-2xl" />;
  if (state.error) return <p role="alert" className="text-sm text-danger">{String(state.error)}</p>;
  const scenes = state.data?.scenes ?? [];
  if (!scenes.length) return <section className={compact ? 'px-4 text-center' : 'rounded-2xl border border-edge bg-surface-panel p-6'}>
    <h2 className={compact ? 'text-sm font-medium text-fg-muted' : 'font-medium text-fg'}>{zh ? '今天没有需要你接手的变化' : 'Nothing needs your attention today'}</h2>
    <p className={compact ? 'mx-auto mt-2 max-w-lg text-xs leading-5 text-fg-subtle' : 'mt-2 text-sm text-fg-muted'}>{zh ? '继续工作即可。需要持续关注的事，可以直接在项目或对话里交给助理。' : 'Keep working. You can ask the assistant to follow something from its project or conversation.'}</p>
  </section>;
  const visible = compact ? scenes.slice(0, 3) : scenes;
  return <section aria-labelledby="proactive-scenes-title">
    <div className="mb-3 flex items-center justify-between gap-3 px-1">
      <h2 id="proactive-scenes-title" className="text-sm font-semibold text-fg">{zh ? '正在发生的事' : 'What is happening'}</h2>
      <Link className="text-xs text-fg-subtle hover:text-accent" to="/assistant-work">{zh ? '助理跟进' : 'Assistant follow-ups'}</Link>
    </div>
    <div className="space-y-3">{visible.map(scene => <SceneMoment key={scene.id} scene={scene} zh={zh} />)}</div>
    {compact && scenes.length > visible.length && <Link className="mt-3 block text-sm text-accent" to="/assistant-work">{zh ? `还有 ${scenes.length - visible.length} 个场景` : `${scenes.length - visible.length} more scenes`}</Link>}
  </section>;
}
