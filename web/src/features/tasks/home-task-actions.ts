import { TaskExecutorSelectionSchema, type TaskRetryResult } from '@xopcai/gateway-contract';

import { fetchTask, retryTask, type TaskDetail } from './home-api';

export async function retryHomeTask(taskId: string, language: 'zh' | 'en' = 'en'): Promise<TaskRetryResult> {
  const detail = await fetchTask(taskId);
  const action = detail.presentation.primaryAction;
  if (action?.type !== 'retry_run') {
    throw new Error(taskRetryMessage({ status: 'changed' }, language));
  }
  return retryTask(taskId, action.runId);
}

export function taskRetryMessage(result: TaskRetryResult, language: 'zh' | 'en'): string {
  const zh = language === 'zh';
  switch (result.status) {
    case 'queued': return zh ? '任务已排队。' : 'Task queued.';
    case 'running':
    case 'verifying': return zh ? '任务正在处理。' : 'Task is in progress.';
    case 'waiting': return zh ? '任务正在等待所需操作。' : 'The task is waiting for a required action.';
    case 'succeeded': return zh ? '任务已完成。' : 'Task completed.';
    case 'failed': return zh ? '这次重试未完成，请查看任务详情。' : 'The retry failed. Review the task details.';
    case 'waiting_connection':
      if (result.reason === 'check_failed') return zh ? '暂时无法检查连接。请在聊天中查看连接状态。' : 'The connection check failed. View the connection in chat.';
      if (result.connectionPhase === 'ready' || result.connectionPhase === 'queued') {
        return zh ? '连接已就绪，原任务会自动继续。' : 'The connection is ready. The original task will resume automatically.';
      }
      return zh ? '请在聊天中完成任务所需的连接操作。' : 'Complete the required connection in chat.';
    case 'not_retryable':
      if (result.reason === 'read_scope_unverified') return zh ? '无法确认上次执行的操作可以安全重跑。请查看任务详情。' : 'The previous execution could not be verified for a safe retry. Review the task details.';
      break;
    case 'blocked':
      if (result.reason === 'account_unavailable') return zh ? '原任务的账号或执行者权限不可用。' : 'The original account or executor access is unavailable.';
      return zh ? '任务仍有待处理事项，请查看详情。' : 'The task has a pending item. Review the task details.';
  }
  return zh ? '任务暂时无法重试，请查看当前状态。' : 'Task is no longer available for retry. Review its current state.';
}

/** Reuse the current executor without inventing an agent or workflow assignment. */
export function homeTaskExecutor(detail: TaskDetail) {
  const latest = detail.runs.filter((run) => !run.parentRunId)
    .sort((left, right) => right.queuedAt - left.queuedAt)[0];
  const agentId = detail.conversation?.currentExecutorAgentId ?? detail.task.delegateAgentId;
  const candidate = agentId ? { kind: 'agent', agentId }
      : latest ? { ...latest.executorRef, kind: latest.executorKind } : undefined;
  const parsed = TaskExecutorSelectionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
