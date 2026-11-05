import type { ProjectTaskCard } from '@xopcai/gateway-contract';
import { Link, useLocation } from 'react-router-dom';
import useSWR from 'swr';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fetchProjectOperatingView,
  type ProjectWithDetails,
} from '@/features/projects/api';
import { selectOverviewTasks } from '@/features/projects/project-overview-model';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { messages } from '@/i18n/messages';
import { withReturnTo } from '@/lib/navigation-return';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import type { ProductPreviewTarget } from './product-preview-route';

const linkClass =
  'rounded text-sm text-accent-fg hover:underline focus-visible:ring-2 focus-visible:ring-accent';
const needsUser = (task: ProjectTaskCard) =>
  task.attention.some(
    (item) =>
      item.kind === 'input_required' || item.kind === 'approval_required',
  );

export function ProjectPreview({
  project,
  target,
}: {
  project: ProjectWithDetails;
  target: ProductPreviewTarget;
}) {
  const language = useLocaleStore((state) => state.language);
  const token = useGatewayStore((state) => state.conversationId);
  const location = useLocation();
  const zh = language === 'zh';
  const pm = messages(language).projectDetailPage;
  const {
    data: view,
    error,
    isLoading,
    mutate,
  } = useSWR(
    ['chat-project-operating-view', target.id, token],
    () => fetchProjectOperatingView(target.id),
    { shouldRetryOnError: false },
  );
  const origin = `${location.pathname}${location.search}`;
  const projectPath = `/projects/${encodeURIComponent(target.id)}`;
  const projectHref = (tab: string) => {
    const params = new URLSearchParams();
    if (target.ownerAgentId) params.set('agentId', target.ownerAgentId);
    return withReturnTo(
      `${projectPath}/${tab}${params.size ? `?${params}` : ''}`,
      origin,
    );
  };
  const taskHref = (id: string) => taskDetailModalHref(origin, id);
  const tasks = view?.tasks ?? [];
  const counts = { moving: 0, ready: 0, waiting: 0, needsUser: 0, done: 0 };
  for (const task of tasks) {
    if (task.phase === 'closed') {
      if (task.resolution === 'done') counts.done++;
    } else if (needsUser(task)) counts.needsUser++;
    else if (['queued', 'running', 'verifying'].includes(task.operationalState))
      counts.moving++;
    else if (['waiting', 'blocked'].includes(task.operationalState))
      counts.waiting++;
    else counts.ready++;
  }
  const countLabels = {
    moving: zh ? '进行中' : 'In progress',
    ready: zh ? '待处理' : 'To do',
    waiting: zh ? '等待中' : 'Waiting',
    needsUser: zh ? '等你处理' : 'Needs you',
    done: zh ? '已完成' : 'Completed',
  };
  const openIds = new Set(
    tasks.filter((task) => task.phase !== 'closed').map((task) => task.id),
  );
  const attention = (view?.blockers ?? [])
    .filter((item) => openIds.has(item.taskId))
    .sort(
      (a, b) =>
        Number(['input_required', 'approval_required'].includes(b.kind)) -
        Number(['input_required', 'approval_required'].includes(a.kind)),
    );
  const uniqueAttention = attention
    .filter(
      (item, index) =>
        attention.findIndex((other) => other.taskId === item.taskId) === index,
    )
    .slice(0, 2);
  const currentTasks = selectOverviewTasks(tasks, tasks.length)
    .sort(
      (a, b) =>
        Number(
          ['queued', 'running', 'verifying'].includes(b.operationalState),
        ) -
        Number(['queued', 'running', 'verifying'].includes(a.operationalState)),
    )
    .slice(0, 3);
  const progress = [
    ...(project.recentUpdates ?? []).map((update, index) => ({
      id: `update:${update.id ?? index}`,
      source: 'project',
      summary: update.summary,
      at: update.createdAt,
      title: zh ? '项目进展' : 'Project update',
      href: projectHref('progress'),
    })),
    ...(view?.recentResults ?? []).map(({ taskId, taskTitle, receipt }) => ({
      id: `receipt:${receipt.runId}`,
      source: `task:${taskId}`,
      summary: receipt.summary,
      at: receipt.finalizedAt,
      title: `${taskTitle} · ${zh ? { passed: '验证通过', failed: '验证失败', unverified: '未验证' }[receipt.verification.status] : receipt.verification.status}`,
      href: taskHref(taskId),
    })),
  ]
    .filter((item) => item.summary?.trim())
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  const recent = progress
    .filter(
      (item, index) =>
        progress.findIndex(
          (other) =>
            other.source === item.source &&
            other.summary.trim() === item.summary.trim(),
        ) === index,
    )
    .slice(0, 3);
  const dateLabel = (value: string | number | undefined) => {
    if (value === undefined || !Number.isFinite(new Date(value).getTime()))
      return null;
    return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  };
  const updatedAt = dateLabel(project.lastActiveAt || project.updatedAt);
  const goal = project.outcome || project.description || project.brief;
  const health = {
    unknown: zh ? '项目健康度尚未评估' : 'Project health not assessed',
    on_track: zh ? '进展正常' : 'On track',
    at_risk: zh ? '存在风险' : 'At risk',
    off_track: zh ? '偏离计划' : 'Off track',
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 break-words text-xl font-semibold text-fg">
            {project.name}
          </h2>
          <span className="shrink-0 rounded-md bg-surface-inset px-2 py-1 text-xs text-fg-muted">
            {pm.statuses[project.status]}
          </span>
        </div>
        {goal ? (
          <div className="line-clamp-3 text-sm text-fg-muted">
            <MarkdownView content={goal} mermaidActions={false} />
          </div>
        ) : (
          <p className="text-sm text-fg-muted">
            {zh ? '尚未填写项目目标。' : 'No project goal recorded yet.'}
          </p>
        )}
        <p className="text-xs text-fg-muted">
          {health[project.health]}
          {updatedAt
            ? ` · ${zh ? '最近活动' : 'Last activity'} ${updatedAt}`
            : ''}
        </p>
      </div>

      <section
        aria-label={zh ? '当前概况' : 'Overview'}
        className="space-y-3 rounded-xl border border-edge bg-surface-inset/50 p-4"
      >
        <h3 className="text-sm font-semibold text-fg">
          {zh ? '当前概况' : 'Overview'}
        </h3>
        {isLoading ? (
          <div aria-busy="true" className="space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : error || !view ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-sm text-fg-muted"
          >
            <span>
              {zh
                ? '任务概况暂时无法读取。'
                : 'Task overview is temporarily unavailable.'}
            </span>
            <button
              type="button"
              onClick={() => void mutate()}
              className={linkClass}
            >
              {zh ? '重试' : 'Retry'}
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm leading-6 text-fg">
              {tasks.length === 0
                ? zh
                  ? '尚未关联任务，可在项目中添加下一步工作。'
                  : 'No tasks linked yet. Add the next piece of work in the project.'
                : zh
                  ? `${counts.moving} 项任务正在推进，${counts.needsUser} 项等你处理，${counts.waiting} 项等待中。`
                  : `${counts.moving} in progress, ${counts.needsUser} need your input, ${counts.waiting} waiting.`}
            </p>
            {view.digest.recommendedAction && (
              <p className="break-words text-sm leading-6 text-fg-muted">
                {zh ? '建议下一步：' : 'Suggested next step: '}
                {view.digest.recommendedAction}
              </p>
            )}
            <dl className="grid grid-cols-3 gap-3 border-t border-edge pt-3 sm:grid-cols-5">
              {(Object.keys(countLabels) as (keyof typeof counts)[]).map(
                (key) => (
                  <div key={key}>
                    <dt className="text-xs text-fg-muted">
                      {countLabels[key]}
                    </dt>
                    <dd className="mt-1 text-xl font-semibold tabular-nums text-fg">
                      {counts[key]}
                    </dd>
                  </div>
                ),
              )}
            </dl>
          </>
        )}
      </section>

      {view && (
        <div className="grid gap-6 sm:grid-cols-2">
          <section className="min-w-0 space-y-3">
            <h3 className="text-sm font-semibold text-fg">
              {zh ? '优先关注' : 'Needs attention'}
            </h3>
            {uniqueAttention.length ? (
              <ul className="divide-y divide-edge">
                {uniqueAttention.map((item) => (
                  <li key={item.taskId} className="py-3 first:pt-0">
                    <Link
                      to={taskHref(item.taskId)}
                      className="block rounded-lg focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <p className="break-words text-sm font-medium text-fg">
                        {item.title}
                      </p>
                      <p className="mt-1 line-clamp-3 break-words text-sm leading-6 text-fg-muted">
                        {item.detail}
                      </p>
                      <span className={`mt-2 inline-block ${linkClass}`}>
                        {zh ? '查看关联任务 →' : 'View task →'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-6 text-fg-muted">
                {zh
                  ? '暂无已记录的阻塞或待处理提醒。'
                  : 'No recorded blockers or attention items.'}
              </p>
            )}
          </section>
          <section className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-fg">
                {zh ? '当前任务' : 'Current tasks'}
              </h3>
              <Link to={projectHref('tasks')} className={linkClass}>
                {zh ? '查看全部' : 'View all'}
              </Link>
            </div>
            {currentTasks.length ? (
              <ul className="divide-y divide-edge">
                {currentTasks.map((task) => (
                  <li key={task.id}>
                    <Link
                      to={taskHref(task.id)}
                      className="block rounded-lg py-3 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <p className="break-words text-sm font-medium text-fg">
                        {task.title}
                      </p>
                      <p className="mt-1 text-xs text-fg-muted">
                        {pm.board.phases[task.phase]}
                        {task.operationalState !== 'idle'
                          ? ` · ${pm.board.operationalStates[task.operationalState]}`
                          : ''}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-6 text-fg-muted">
                {zh
                  ? '暂无可推进的任务，等待中的任务可在全部任务中查看。'
                  : 'No actionable tasks. View all tasks to see any waiting work.'}
              </p>
            )}
          </section>
        </div>
      )}

      <section className="space-y-3 border-t border-edge pt-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-fg">
            {zh ? '最近进展' : 'Recent progress'}
          </h3>
          <Link to={projectHref('progress')} className={linkClass}>
            {zh ? '查看记录' : 'View history'}
          </Link>
        </div>
        {recent.length ? (
          <ul className="divide-y divide-edge-subtle">
            {recent.map((item) => (
              <li key={item.id} className="space-y-2 py-3 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 break-words text-xs text-fg-muted">
                    {item.title}
                    {dateLabel(item.at) ? ` · ${dateLabel(item.at)}` : ''}
                  </p>
                  <Link to={item.href} className={linkClass}>
                    {zh ? '查看来源' : 'View source'}
                  </Link>
                </div>
                <div className="line-clamp-3 break-words text-sm text-fg">
                  <MarkdownView content={item.summary} mermaidActions={false} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">
            {zh
              ? '暂无项目进展或执行结果。'
              : 'No project updates or execution results yet.'}
          </p>
        )}
      </section>
    </div>
  );
}
