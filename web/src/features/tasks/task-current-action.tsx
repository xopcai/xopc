import { Link } from 'react-router-dom';

import type { TaskDetail } from './home-api';
import { currentTaskReceipt } from './task-detail-summary';
import { TaskExpandableContent } from './task-expandable-content';
import { TaskInputCard } from './task-input-card';
import { taskChatHref } from './task-detail-route';

/** Keep actionable waits ahead of supporting status and historical results. */
export function TaskCurrentAction({ detail, language, onUpdated }: {
  detail: TaskDetail;
  language: 'zh' | 'en';
  onUpdated: (detail: TaskDetail) => void;
}) {
  const zh = language === 'zh';
  const pausedWait = detail.waits.find((wait) => wait.kind === 'paused');
  const actionableWaits = detail.allowedCommands.includes('resolve_wait') && !pausedWait
    ? detail.waits.filter((wait) => (wait.kind === 'user_input'
      || (wait.kind === 'approval' && typeof wait.condition.capability === 'string'))
      && wait.condition.type !== 'connection')
    : [];
  const needsAttention = actionableWaits.length > 0 || detail.attention.some((item) => item.kind === 'input_required' || item.kind === 'approval_required');
  const receipt = currentTaskReceipt(detail);
  const running = detail.runs.some((run) => !run.parentRunId && ['queued', 'running', 'waiting', 'verifying'].includes(run.status));
  const summary = pausedWait?.reason ?? detail.waits[0]?.reason
    ?? (detail.task.phase === 'closed'
      ? (zh ? '任务已关闭，可查看交付物与执行结果。' : 'The task is closed. Review its deliverables and results.')
      : detail.task.phase === 'review'
        ? (zh ? '请检查交付物与验收项，通过后确认完成。' : 'Review the deliverables and acceptance criteria before completing the task.')
        : running
          ? (zh ? 'Agent 正在执行任务，无需你操作。' : 'The agent is working. No action is needed from you.')
          : receipt?.summary ?? (zh ? '任务尚未开始，可开始执行或设置执行时间。' : 'Start the task or set an execution time.'));
  const attentionContent = detail.attention.length > 0 ? <ul className="mt-3 space-y-3">
    {detail.attention.map((item, index) => {
      const hasInlineControl = actionableWaits.some((wait) => (item.kind === 'input_required' && wait.kind === 'user_input')
        || (item.kind === 'approval_required' && wait.kind === 'approval'));
      return <li key={`${item.kind}-${index}`} className="text-sm leading-6 text-fg-muted">
        <TaskExpandableContent content={item.summary} contentKey={`${detail.task.id}:attention:${item.kind}:${index}`} language={language} markdown={false} previewHeight={72} />
        {!hasInlineControl && (item.kind === 'input_required' || item.kind === 'approval_required') ? <Link className="mt-2 inline-flex min-h-11 items-center rounded-lg bg-accent-soft px-3 font-medium text-accent-fg" to={taskChatHref(detail.task.id)}>{zh ? (item.kind === 'approval_required' ? '查看并决定' : '补充信息') : (item.kind === 'approval_required' ? 'Review decision' : 'Provide information')}</Link> : null}
      </li>;
    })}
  </ul> : null;

  return <section aria-label={zh ? '当前需要处理' : 'Current action'} className="rounded-xl border border-edge bg-surface-panel p-4">
    <h2 className="text-sm font-semibold text-fg">{needsAttention
      ? (zh ? '需要你处理' : 'Your action needed')
      : (zh ? '当前进展' : 'Current progress')}{actionableWaits.length > 1 ? ` · ${actionableWaits.length}` : ''}</h2>
    {actionableWaits.map((wait) => <TaskInputCard key={wait.id} wait={wait} detail={detail} zh={zh} onUpdated={onUpdated} />)}
    {actionableWaits.length > 0 ? attentionContent ? <details className="mt-3"><summary className="cursor-pointer text-xs text-fg-muted">{zh ? '等待详情' : 'Waiting details'}</summary>{attentionContent}</details> : null
      : attentionContent ?? <TaskExpandableContent content={summary} contentKey={`${detail.task.id}:current-progress`} language={language} markdown={false} previewHeight={72} className="mt-2 text-sm leading-6 text-fg-muted" />}

  </section>;
}
