import { taskDescriptionForDisplay, type TaskRunStatus } from '@xopcai/gateway-contract';
import { Bell, MessageCircle } from 'lucide-react';
import { useState, type Ref } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { ChatMarkdownRenderer } from '@/features/chat/rendering/markdown/chat-markdown-renderer';
import {
  acknowledgeWorkbenchFollowUpApi,
  formatOneShotFollowUpStatus,
  PersonalOneShotFollowUpDialog,
  stopOneShotFollowUpApi,
} from '@/features/personal-agent/personal-one-shot-follow-up';

import { fetchTask, type TaskDetail } from './home-api';
import { currentTaskReceipt } from './task-detail-summary';
import { TaskExpandableContent } from './task-expandable-content';
import { TaskInputCard } from './task-input-card';
import { taskChatHref } from './task-detail-route';
import { taskTextForDisplay } from './task-result-presentation';

/** Keep actionable waits ahead of supporting status and historical results. */
export function TaskCurrentAction({ detail, executorName, language, onUpdated, ref }: {
  detail: TaskDetail;
  executorName?: string;
  language: 'zh' | 'en';
  onUpdated: (detail: TaskDetail) => void;
  ref?: Ref<HTMLElement>;
}) {
  const zh = language === 'zh';
  const navigate = useNavigate();
  const [followUpDialogId, setFollowUpDialogId] = useState<string | null>(null);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [followUpNotice, setFollowUpNotice] = useState<string | null>(null);
  const [ackBusy, setAckBusy] = useState(false);

  const pausedWait = detail.waits.find((wait) => wait.kind === 'paused');
  const actionableWaits = detail.allowedCommands.includes('resolve_wait') && !pausedWait
    ? detail.waits.filter((wait) => (wait.kind === 'user_input'
      || (wait.kind === 'approval' && typeof wait.condition.capability === 'string'))
      && wait.condition.type !== 'connection')
    : [];
  const needsAttention = detail.presentation.status === 'needsUser';
  const receipt = currentTaskReceipt(detail);
  const activeRun = detail.runs.find((run) => !run.parentRunId && ['queued', 'running', 'waiting', 'verifying'].includes(run.status));
  const activeProgress: Partial<Record<TaskRunStatus, string>> = {
    queued: zh ? '等待开始执行。' : 'Waiting to start.',
    running: executorName
      ? (zh ? `${executorName} 正在处理任务。` : `${executorName} is working on the task.`)
      : (zh ? '任务处理中。' : 'The task is in progress.'),
    waiting: zh ? '任务正在等待继续。' : 'The task is waiting to resume.',
    verifying: zh ? '正在检查执行结果。' : 'Checking the result.',
  };
  const summary = taskTextForDisplay(detail.presentation.reason ?? pausedWait?.reason ?? detail.waits[0]?.reason
    ?? (detail.task.phase === 'closed'
      ? receipt?.summary ?? (zh ? '任务已关闭，可查看交付物与执行结果。' : 'The task is closed. Review its deliverables and results.')
      : detail.task.phase === 'review'
        ? (zh ? '请检查交付物并勾选通过的验收项。' : 'Review the deliverables and check the criteria that pass.')
        : (activeRun && activeProgress[activeRun.status]) ?? receipt?.summary
          ?? (zh ? '任务尚未开始，可开始执行或设置执行时间。' : 'Start the task or set an execution time.')), language);

  const primaryFollowUp = detail.oneShotFollowUps?.[0];
  const unreadWorkbenchAlert = primaryFollowUp?.destination === 'workbench'
    && primaryFollowUp.outreach?.state === 'published'
    && primaryFollowUp.outreach.acknowledgedAt === null
    ? primaryFollowUp.outreach
    : null;

  async function refreshTaskDetail() {
    try {
      const latest = await fetchTask(detail.task.id);
      onUpdated(latest);
    } catch {
      // Realtime or SWR revalidation will recover on transient fetch error.
    }
  }

  async function handleStopFollowUp() {
    if (!primaryFollowUp || followUpBusy) return;
    setFollowUpBusy(true);
    setFollowUpNotice(null);
    try {
      const result = await stopOneShotFollowUpApi(primaryFollowUp.followUpId, primaryFollowUp.revision);
      if (result.outcome === 'already_delivered') {
        setFollowUpNotice(zh ? '已提醒，跟进已结束。' : 'Already reminded; follow-up has ended.');
      } else if (result.outcome === 'stopped') {
        setFollowUpNotice(zh ? '已停止这次跟进。' : 'Follow-up stopped.');
      }
      await refreshTaskDetail();
    } catch {
      await refreshTaskDetail();
    } finally {
      setFollowUpBusy(false);
    }
  }

  async function handleAcknowledgeWorkbenchAlert() {
    if (!unreadWorkbenchAlert || ackBusy) return;
    setAckBusy(true);
    try {
      await acknowledgeWorkbenchFollowUpApi(unreadWorkbenchAlert.outreachId);
      await refreshTaskDetail();
    } finally {
      setAckBusy(false);
    }
  }

  function discussWithPersonal() {
    navigate('/personal', {
      state: {
        attachTaskContext: {
          kind: 'task' as const,
          sourceId: detail.task.id,
          expectedVersion: String(detail.task.version),
          title: detail.task.title,
        },
      },
    });
  }

  const attentionContent = detail.attention.length > 0 ? <ul className="mt-3 space-y-3">
    {detail.attention.map((item, index) => {
      const hasInlineControl = actionableWaits.some((wait) => (item.kind === 'input_required' && wait.kind === 'user_input')
        || (item.kind === 'approval_required' && wait.kind === 'approval'));
      const text = taskTextForDisplay(item.summary, language);
      return <li key={`${item.kind}-${index}`} className="text-sm leading-6 text-fg-muted">
        <TaskExpandableContent content={text} contentKey={`${detail.task.id}:attention:${item.kind}:${index}`} language={language} previewHeight={72}>
          <ChatMarkdownRenderer content={taskDescriptionForDisplay(text)} compact breaks />
        </TaskExpandableContent>
        {!hasInlineControl && (item.kind === 'input_required' || item.kind === 'approval_required') ? <Link className="mt-2 inline-flex min-h-11 items-center rounded-lg bg-accent-soft px-3 font-medium text-accent-fg" to={taskChatHref(detail.task.id)}>{zh ? (item.kind === 'approval_required' ? '查看并决定' : '补充信息') : (item.kind === 'approval_required' ? 'Review decision' : 'Provide information')}</Link> : null}
      </li>;
    })}
  </ul> : null;

  return <section ref={ref} tabIndex={-1} aria-label={zh ? '当前需要处理' : 'Current action'} className="rounded-xl bg-surface-panel p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-fg">{needsAttention
        ? (zh ? '需要你处理' : 'Your action needed')
        : (zh ? '当前进展' : 'Current progress')}{actionableWaits.length > 1 ? ` · ${actionableWaits.length}` : ''}</h2>
      {detail.task.phase !== 'closed' && (
        <Button
          type="button"
          variant="ghost"
          className="min-h-8 gap-1.5 px-2.5 text-xs text-fg-muted hover:text-fg"
          onClick={discussWithPersonal}
        >
          <MessageCircle className="size-3.5" aria-hidden />
          {zh ? '和智能体讨论' : 'Discuss with agent'}
        </Button>
      )}
    </div>

    {unreadWorkbenchAlert && (
      <div
        role="status"
        data-workbench-followup-unread
        className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-accent/35 bg-accent-soft/45 px-3.5 py-3 text-sm"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-accent-fg">
            <Bell className="size-3.5 shrink-0" aria-hidden />
            {zh ? '约定提醒已到达' : 'Scheduled follow-up reminder'}
          </p>
          <p className="text-xs leading-5 text-fg">
            {unreadWorkbenchAlert.text || (zh ? '到约定检查时刻，该待决项仍需你处理。' : 'This pending item still requires your decision.')}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="min-h-8 shrink-0 px-2.5 text-xs"
          disabled={ackBusy}
          onClick={() => void handleAcknowledgeWorkbenchAlert()}
        >
          {ackBusy ? (zh ? '确认中' : 'Confirming') : (zh ? '知道了' : 'Acknowledge')}
        </Button>
      </div>
    )}

    {primaryFollowUp && (
      <div
        data-task-one-shot-followup={primaryFollowUp.followUpId}
        className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-surface-inset/60 px-3 py-2 text-xs"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Bell className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
          <span className="truncate text-fg">
            {zh ? '条件跟进：' : 'Follow-up: '}
            <span className="font-medium">{formatOneShotFollowUpStatus(primaryFollowUp, zh)}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setFollowUpDialogId(primaryFollowUp.followUpId)}
            className="rounded px-2 py-1 font-medium text-accent hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {zh ? '查看跟进' : 'View follow-up'}
          </button>
          {primaryFollowUp.status === 'active' && (
            <button
              type="button"
              disabled={followUpBusy}
              onClick={() => void handleStopFollowUp()}
              className="rounded border border-edge px-2 py-1 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50"
            >
              {followUpBusy ? (zh ? '正在停止' : 'Stopping') : (zh ? '停止跟进' : 'Stop follow-up')}
            </button>
          )}
        </div>
      </div>
    )}
    {followUpNotice && (
      <p role="status" className="mt-2 text-xs text-fg-muted">{followUpNotice}</p>
    )}

    {actionableWaits.map((wait) => <TaskInputCard key={wait.id} wait={wait} detail={detail} zh={zh} onUpdated={onUpdated} />)}
    {actionableWaits.length > 0 ? attentionContent ? <details className="mt-3"><summary className="cursor-pointer text-xs text-fg-muted">{zh ? '等待详情' : 'Waiting details'}</summary>{attentionContent}</details> : null
      : attentionContent ?? <TaskExpandableContent content={summary} contentKey={`${detail.task.id}:current-progress`} language={language} previewHeight={72} className="mt-2 text-sm leading-6 text-fg-muted">
        <ChatMarkdownRenderer content={taskDescriptionForDisplay(summary)} compact />
      </TaskExpandableContent>}

    {followUpDialogId && (
      <PersonalOneShotFollowUpDialog
        followUpId={followUpDialogId}
        open={Boolean(followUpDialogId)}
        onOpenChange={open => { if (!open) setFollowUpDialogId(null); }}
        onChanged={() => void refreshTaskDetail()}
      />
    )}
  </section>;
}
