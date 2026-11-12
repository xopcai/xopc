import { useId, useState, type ReactNode } from 'react';
import { CircleCheck, Clock3, Files, ListTodo, Paperclip, Pencil, ShieldCheck } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { SlidingTabList } from '@/components/ui/sliding-tab-list';
import { attachmentFromDeliverable } from '@/features/chat/attachments/attachment-utils-core';
import { TASK_DETAIL_MODAL_PARAM, taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { cn } from '@/lib/cn';
import { preloadTaskDetailPage } from '@/lib/route-preload';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { PersonalDeliverablesPanel } from './personal-deliverables-panel';
import { PersonalSchedules } from './personal-schedules';
import { formatPersonalTaskTime } from './personal-task-time';
import { PersonalAvatar } from './personal-avatar';
import { usePersonalProfile } from './use-personal-profile';
import {
  isOpenPersonalPrompt, needsPersonalWorkAttention, personalWorkStatus,
  usePersonalListPagination, usePersonalWorkHistory, usePersonalWorkOverview, type PersonalWorkItem,
} from './use-personal-work';

const rowClass = 'flex min-w-0 items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent';
const rowIconClass = 'mt-0.5 grid size-5 shrink-0 place-items-center text-fg-muted';
type PersonalTab = 'tasks' | 'deliverables';

function groupTasksByDate(items: PersonalWorkItem[], zh: boolean) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const week = new Date(today);
  week.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const month = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthLabel = new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long' });
  const currentYearMonthLabel = new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', { month: 'long' });
  const seen = new Set<string>();
  const groups = new Map<string, { title: string; dateInHeading: boolean; items: PersonalWorkItem[] }>();
  for (const item of [...items].sort((left, right) => right.updatedAt - left.updatedAt)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const title = item.updatedAt >= +today ? (zh ? '今天' : 'Today')
      : item.updatedAt >= +yesterday ? (zh ? '昨天' : 'Yesterday')
        : item.updatedAt >= +week ? (zh ? '本周' : 'This week')
          : item.updatedAt >= +month ? (zh ? '本月' : 'This month')
            : item.updatedAt > 0 ? (new Date(item.updatedAt).getFullYear() === today.getFullYear() ? currentYearMonthLabel : monthLabel).format(item.updatedAt)
              : (zh ? '更早' : 'Earlier');
    const group = groups.get(title);
    if (group) group.items.push(item);
    else groups.set(title, { title, dateInHeading: item.updatedAt >= +yesterday, items: [item] });
  }
  return [...groups.values()];
}

function WorkRow({ item, zh, scope, personalHref, dateInHeading, onNavigate }: {
  item: PersonalWorkItem; zh: boolean; scope: string; personalHref: string; dateInHeading?: boolean; onNavigate?: () => void;
}) {
  const [status, tone] = personalWorkStatus(item, zh);
  const result = item.phase === 'closed' && item.resolution === 'done';
  const Icon = item.attention ? ShieldCheck : result ? CircleCheck : item.phase === 'closed' ? Clock3 : ListTodo;
  const working = item.operationalState === 'running' || item.operationalState === 'verifying';
  const body = <>
    <span className={rowIconClass} aria-hidden><Icon className="size-4" strokeWidth={1.7} /></span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm leading-5 font-medium text-fg" title={item.title}>{item.title}</span>
      <span className="flex items-center gap-1.5 text-xs leading-5 text-fg-muted">
        <span className={cn('size-1.5 shrink-0 rounded-full', tone)} aria-hidden />
        <span className="truncate">{status}</span>
        {item.updatedAt > 0 ? <>
          <span aria-hidden>·</span>
          <time className="shrink-0 text-fg-subtle" dateTime={new Date(item.updatedAt).toISOString()} title={formatMediumDateTime(item.updatedAt, zh ? 'zh' : 'en')}>
            {formatPersonalTaskTime(item.updatedAt, zh, dateInHeading)}
          </time>
        </> : null}
      </span>
    </span>
  </>;
  const className = cn(rowClass, working && 'bg-surface-hover/75');
  if (item.prompt) return <Link to={item.prompt.conversationId === scope ? personalHref : `/chat/${encodeURIComponent(item.prompt.conversationId)}`}
    state={{ focusClarification: item.prompt.id }} onClick={onNavigate} className={className}>{body}</Link>;
  const artifact = item.artifact;
  return <div className="flex min-w-0 items-center gap-1">
    <Link to={taskDetailModalHref(personalHref, item.id)}
      state={{ taskPreview: { id: item.id, title: item.title }, focusTaskResults: result ? item.id : undefined }}
      onPointerEnter={preloadTaskDetailPage} onFocus={preloadTaskDetailPage} onClick={onNavigate}
      className={cn(className, 'flex-1 active:bg-surface-hover')}>{body}</Link>
    {artifact ? <button type="button" title={artifact.title} aria-label={`${zh ? '打开' : 'Open'} ${artifact.title}`}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onClick={() => useRightWorkspaceStore.getState().openFile({ attachment: attachmentFromDeliverable(artifact), conversationId: scope }, scope)}>
      <Paperclip className="size-4" aria-hidden />
    </button> : null}
  </div>;
}

function WorkGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-1">
    <h3 className="px-2 text-xs font-semibold text-fg-muted">{title}</h3>
    <ul className="space-y-0.5">{children}</ul>
  </section>;
}

export function PersonalTaskPanel({ scope, zh, closeOnNavigate = false, visible = true, onNavigate }: {
  scope: string; zh: boolean; closeOnNavigate?: boolean; visible?: boolean; onNavigate?: () => void;
}) {
  const [tab, setTab] = useState<PersonalTab>('tasks');
  const [deliverablesVisited, setDeliverablesVisited] = useState(false);
  const panelId = useId();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  search.delete(TASK_DETAIL_MODAL_PARAM);
  if (closeOnNavigate) search.delete('workspaceTab');
  const query = search.toString();
  const personalHref = query ? `${location.pathname}?${query}` : location.pathname;
  const { work: data, workError: error, prompt, refreshWork: mutate, avatarState, summary, attentionCount } = usePersonalWorkOverview(scope, zh);
  const tasksVisible = tab === 'tasks';
  const { items: historyItems, error: historyError, loading, hasMore, loadMore, retry } = usePersonalWorkHistory(scope, data, tasksVisible);
  const { listRef, loadMoreRef } = usePersonalListPagination(visible && hasMore && !loading && !historyError, loadMore);
  const { profile, displayName } = usePersonalProfile();
  const current = data?.current ?? [];
  const currentIds = new Set(current.map(item => item.id));
  const attention = current.filter(needsPersonalWorkAttention);
  const attentionIds = new Set(attention.map(item => item.id));
  const pending = current.filter(item => !attentionIds.has(item.id));
  const ended = (item: PersonalWorkItem) => item.phase === 'closed'
    || item.operationalState === 'failed' || item.operationalState === 'cancelled';
  const active = pending.filter(item => !ended(item));
  const groups = groupTasksByDate([...pending.filter(ended), ...historyItems.filter(item => !currentIds.has(item.id))], zh);
  const mainPrompt = isOpenPersonalPrompt(prompt) && !attention.some(item => item.prompt?.id === prompt.id) ? prompt : null;
  const closePanel = onNavigate ?? (closeOnNavigate ? () => useRightWorkspaceStore.getState().setOpen(false, scope) : undefined);
  const row = (item: PersonalWorkItem, dateInHeading = false) => <li key={item.id}><WorkRow item={item} zh={zh} scope={scope} personalHref={personalHref} dateInHeading={dateInHeading} onNavigate={closePanel} /></li>;
  const tabs = [
    { id: 'tasks', label: zh ? '任务' : 'Tasks', Icon: ListTodo },
    { id: 'deliverables', label: zh ? '交付物' : 'Deliverables', Icon: Files },
  ] as const;
  const empty = !current.length && !data?.total && !mainPrompt;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={zh ? '派发的任务' : 'Delegated tasks'}>
    <header data-personal-task-identity className="flex shrink-0 flex-col items-center px-4 pb-7 pt-1 text-center sm:px-6">
      <div className="relative grid size-[7.5rem] place-items-center rounded-full border border-edge-subtle bg-surface-inset sm:size-32">
        <PersonalAvatar appearance={profile?.appearance ?? 'loopi'} agentId={profile?.agentId} activity={avatarState} className="size-full" />
        <Link to="/settings/personal" state={{ settingsBackPath: personalHref }} aria-label={zh ? '编辑助手资料' : 'Edit assistant profile'}
          className="absolute bottom-0 right-0 grid size-9 place-items-center rounded-full border-[3px] border-surface-base bg-surface-hover text-fg hover:bg-surface-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <Pencil className="size-3.5" strokeWidth={1.8} aria-hidden />
        </Link>
      </div>
      <h2 className="mt-3 max-w-full truncate text-[1.375rem] leading-7 font-semibold text-fg">{displayName}</h2>
      <div className="min-h-6 max-w-full">
        {summary ? <p className="mt-1 flex min-h-5 items-center justify-center gap-1.5 text-sm text-fg-muted" title={summary}>
          {avatarState !== 'idle' ? <span className={cn('size-1.5 shrink-0 rounded-full', avatarState === 'waiting' ? 'bg-warning' : 'bg-accent')} aria-hidden /> : null}
          <span className="truncate">{summary}</span>
        </p> : null}
      </div>
    </header>
    <SlidingTabList role="tablist" aria-label={zh ? '任务与交付物' : 'Tasks and deliverables'} className="mx-4 mb-3 grid shrink-0 grid-cols-2 gap-1 rounded-full bg-surface-inset p-1 sm:mx-6"
      indicatorClassName="rounded-full bg-surface-base shadow-sm dark:bg-surface-active dark:shadow-none">
      {tabs.map(({ id, label, Icon }) => <button key={id} type="button" role="tab" id={`${panelId}-${id}-tab`} aria-controls={`${panelId}-${id}`}
        aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => {
          setTab(id);
          if (id === 'deliverables') setDeliverablesVisited(true);
        }}
        className={cn('flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-full px-1 text-xs font-medium whitespace-nowrap text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', tab === id && 'text-fg')}>
        <Icon className="size-4 shrink-0" strokeWidth={1.7} aria-hidden />
        {label}{id === 'tasks' && attentionCount > 0 ? <span className="text-fg-muted" aria-label={zh ? `${attentionCount} 项待处理` : `${attentionCount} need attention`}>{attentionCount}</span> : null}
      </button>)}
    </SlidingTabList>
    <div ref={listRef} hidden={!tasksVisible} role="tabpanel" id={`${panelId}-tasks`} aria-labelledby={`${panelId}-tasks-tab`}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-3 [scrollbar-gutter:stable] sm:px-6">
      {!data && !error && !mainPrompt ? <div className="space-y-2" aria-label={zh ? '正在读取任务' : 'Loading tasks'}>{[0, 1, 2].map(key => <Skeleton key={key} className="h-14 rounded-xl" />)}</div> : null}
      {error ? <p role="alert" className="px-3 pb-3 text-sm text-fg-muted">{zh ? '暂时无法更新任务。' : 'Could not update tasks.'} <button type="button" className="text-accent-fg underline" onClick={() => void mutate()}>{zh ? '重试' : 'Try again'}</button></p> : null}
      {data && empty ? <p className="px-2 py-6 text-center text-sm text-fg-muted">
        {zh ? '可以在对话里交代你想推进的事。' : 'Delegate work from the conversation.'}
      </p> : null}
      <div className="space-y-5">
        {mainPrompt || attention.length ? <WorkGroup title={zh ? '待你处理' : 'Needs your attention'}>
          {mainPrompt ? <li><Link to={personalHref} state={{ focusClarification: mainPrompt.id }} className={rowClass} onClick={closePanel}>
            <span className={rowIconClass} aria-hidden><ShieldCheck className="size-[1.125rem]" strokeWidth={1.7} /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium" title={mainPrompt.question}>{mainPrompt.question}</span>
              <span className="block text-xs leading-5 text-fg-muted">{mainPrompt.kind === 'approval' ? (zh ? '待确认' : 'Needs approval') : (zh ? '待回复' : 'Needs a reply')}</span></span>
          </Link></li> : null}
          {attention.map(item => row(item))}
        </WorkGroup> : null}
        {active.length ? <WorkGroup title={zh ? '当前任务' : 'Current tasks'}>{active.map(item => row(item))}</WorkGroup> : null}
        <PersonalSchedules scope={scope} visible={visible && tasksVisible} zh={zh} />
        {groups.map(({ title, items, dateInHeading }) => <WorkGroup key={title} title={title}>{items.map(item => row(item, dateInHeading))}</WorkGroup>)}
        {historyError ? <p role="alert" className="px-2 text-sm text-fg-muted">
          <button type="button" className="min-h-9 text-accent-fg underline" onClick={retry}>{zh ? '加载失败，重试' : 'Loading failed. Try again'}</button>
        </p> : null}
        {loading ? <div role="status" aria-label={zh ? '正在加载更多任务' : 'Loading more tasks'}><Skeleton className="h-14 rounded-xl" /></div> : null}
      </div>
      {hasMore ? <div ref={loadMoreRef} className="h-px" aria-hidden /> : null}
    </div>
    <PersonalDeliverablesPanel scope={scope} zh={zh} enabled={deliverablesVisited} active={visible && !tasksVisible}
      id={`${panelId}-deliverables`} labelledBy={`${panelId}-deliverables-tab`} sourceHref={personalHref} onSource={closePanel} />
  </div>;
}
