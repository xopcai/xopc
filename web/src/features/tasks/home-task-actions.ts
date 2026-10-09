import { TaskExecutorSelectionSchema } from '@xopcai/gateway-contract';

import { commandTask, fetchTask } from './home-api';

export async function retryHomeTask(taskId: string, language: 'zh' | 'en' = 'en'): Promise<void> {
  const detail = await fetchTask(taskId);
  const latest = detail.runs.filter((run) => !run.parentRunId)
    .sort((left, right) => right.queuedAt - left.queuedAt)[0];
  if (!detail.allowedCommands.includes('start') || latest?.status !== 'failed') {
    throw new Error(language === 'zh' ? '任务状态已变化，暂时无法重试。请刷新并查看当前状态。' : 'Task is no longer available for retry. Refresh and review its current state.');
  }
  const executor = TaskExecutorSelectionSchema.parse({ ...latest.executorRef, kind: latest.executorKind });
  await commandTask(taskId, { type: 'start', executor }, detail.task.version);
}
