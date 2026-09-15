import { CalendarClock, FolderKanban, MessageCircleMore, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { ProactiveSceneKind, ProactiveSceneMoment, ProactiveSceneStatus } from './api';

const sceneMeta: Record<ProactiveSceneKind, { Icon: LucideIcon; en: string; zh: string }> = {
  meeting_preparation: { Icon: CalendarClock, en: 'Next meeting', zh: '下一场会议' },
  project_momentum: { Icon: FolderKanban, en: 'Project momentum', zh: '项目进展' },
  communication_follow_up: { Icon: MessageCircleMore, en: 'Waiting on a reply', zh: '沟通跟进' },
};

const statusCopy: Record<ProactiveSceneStatus, { en: string; zh: string }> = {
  needs_decision: { en: 'Needs your decision', zh: '需要你决定' },
  prepared: { en: 'Ready for you', zh: '已为你准备好' },
  changed: { en: 'Something changed', zh: '出现了新变化' },
  following: { en: 'Following quietly', zh: '正在安静跟进' },
};

export function SceneMoment({ scene, zh }: { scene: ProactiveSceneMoment; zh: boolean }) {
  const meta = sceneMeta[scene.kind];
  const status = statusCopy[scene.status];
  const actionRoute = scene.card ? `/assistant-work?item=${encodeURIComponent(scene.card.id)}` : scene.object?.route ?? scene.manageRoute;
  const actionLabel = scene.status === 'needs_decision'
    ? (zh ? '查看并决定' : 'Review and decide')
    : scene.status === 'prepared'
      ? (zh ? '查看准备结果' : 'Open prepared work')
      : scene.status === 'changed'
        ? (zh ? '查看变化' : 'Review change')
      : scene.object
        ? (zh ? `打开${scene.kind === 'project_momentum' ? '项目' : '相关内容'}` : 'Open context')
        : (zh ? '查看安排' : 'View arrangement');
  return <article className="overflow-hidden rounded-2xl border border-edge bg-surface-panel">
    <div className="flex items-start gap-3 border-b border-edge-subtle px-5 py-4">
      <span className="mt-0.5 rounded-xl bg-accent-soft p-2 text-accent"><meta.Icon className="size-4" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{zh ? meta.zh : meta.en}</p>
          <span className={scene.status === 'following' ? 'text-xs text-fg-subtle' : 'text-xs font-medium text-accent'}>{zh ? status.zh : status.en}</span>
        </div>
        <h3 className="mt-1 font-semibold text-fg">{scene.title}</h3>
      </div>
    </div>
    <div className="space-y-4 px-5 py-4">
      <div><p className="text-xs text-fg-subtle">{zh ? '现在' : 'Now'}</p><p className="mt-1 text-sm font-medium text-fg">{scene.moment}</p></div>
      <div><p className="text-xs text-fg-subtle">{scene.status === 'following' ? (zh ? '助理记住的安排' : 'What the assistant remembers') : (zh ? '为什么值得关注' : 'Why it matters')}</p><p className="mt-1 text-sm text-fg-muted">{scene.status === 'following' ? scene.promise : scene.relevance}</p></div>
      <div className="rounded-xl bg-surface-hover px-4 py-3"><p className="text-xs text-fg-subtle">{zh ? '助理已经做了什么' : 'What your assistant did'}</p><p className="mt-1 text-sm text-fg">{scene.help}</p></div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className="text-sm font-medium text-accent" to={actionRoute}>{actionLabel}</Link>
        <Link className="text-xs text-fg-subtle hover:text-fg" to={scene.manageRoute}>{zh ? '调整助理安排' : 'Adjust arrangement'}</Link>
      </div>
    </div>
  </article>;
}
