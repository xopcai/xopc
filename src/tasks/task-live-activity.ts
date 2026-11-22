import type { ToolActivity } from '@xopcai/gateway-contract';

export interface TaskLiveActivitySnapshot {
  taskId: string;
  runId: string;
  stage: 'starting' | 'tool_running' | 'tool_completed' | 'responding';
  toolName?: string;
  stepCount: number;
  summary: string;
  updatedAt: number;
}

const liveActivities = new Map<string, TaskLiveActivitySnapshot>();

function describeToolAction(toolName: string, activity: ToolActivity | undefined, zh: boolean): string {
  if (toolName === 'web_search' || activity?.category === 'web' && activity.action === 'search') {
    return zh ? '正在搜索网页资料' : 'Searching the web';
  }
  if (toolName === 'web_fetch' || toolName === 'web_extract' || activity?.category === 'web') {
    return zh ? '正在读取网页内容' : 'Reading web page';
  }
  if (toolName === 'browser_use' || activity?.category === 'navigation') {
    return zh ? '正在操作浏览器页面' : 'Interacting with browser';
  }
  if (toolName === 'exec_command' || activity?.category === 'command') {
    return zh ? '正在运行命令或脚本' : 'Running command or script';
  }
  if (toolName === 'write_file' || toolName === 'apply_patch' || activity?.action === 'write' || activity?.action === 'edit') {
    return zh ? '正在编写或更新文件' : 'Writing or updating files';
  }
  if (toolName === 'publish_artifacts') {
    return zh ? '正在整理并发布交付物' : 'Publishing deliverables';
  }
  if (toolName === 'image_generate') {
    return zh ? '正在生成图像' : 'Generating image';
  }
  if (toolName === 'read_file' || toolName === 'read_media' || activity?.category === 'file') {
    return zh ? '正在读取文件资料' : 'Reading file inputs';
  }
  if (toolName === 'grep' || toolName === 'find' || activity?.category === 'code') {
    return zh ? '正在检索工作区内容' : 'Searching workspace';
  }
  if (toolName === 'xopc_tool_execute' || toolName === 'tool_search' || toolName === 'xopc_tool_describe') {
    return zh ? '正在访问已连接应用数据' : 'Querying connected app';
  }
  if (toolName === 'task_collaboration') {
    return zh ? '正在同步任务上下文' : 'Syncing task context';
  }
  return zh ? `正在执行 ${toolName}` : `Running ${toolName}`;
}

function formatSummary(actionText: string, stepCount: number, zh: boolean): string {
  if (stepCount <= 1) return actionText;
  return zh ? `${actionText}（第 ${stepCount} 步）` : `${actionText} (step ${stepCount})`;
}

export function recordTaskLiveStart(taskId: string, runId: string, zh: boolean): void {
  liveActivities.set(taskId, {
    taskId,
    runId,
    stage: 'starting',
    stepCount: 0,
    summary: zh ? '已启动执行，正在准备上下文' : 'Started execution; preparing context',
    updatedAt: Date.now(),
  });
}

export function recordTaskLiveToolStart(
  taskId: string,
  runId: string,
  toolName: string,
  activity: ToolActivity | undefined,
  zh: boolean,
): void {
  const prev = liveActivities.get(taskId);
  const stepCount = (prev?.runId === runId ? prev.stepCount : 0) + 1;
  const actionText = describeToolAction(toolName, activity, zh);
  liveActivities.set(taskId, {
    taskId,
    runId,
    stage: 'tool_running',
    toolName,
    stepCount,
    summary: formatSummary(actionText, stepCount, zh),
    updatedAt: Date.now(),
  });
}

export function recordTaskLiveToolEnd(
  taskId: string,
  runId: string,
  toolName: string,
  zh: boolean,
): void {
  const prev = liveActivities.get(taskId);
  if (prev && prev.runId !== runId) return;
  const stepCount = prev?.stepCount ?? 1;
  liveActivities.set(taskId, {
    taskId,
    runId,
    stage: 'tool_completed',
    toolName,
    stepCount,
    summary: zh ? `已完成 ${stepCount} 步工具操作，正在继续分析` : `Completed ${stepCount} tool steps; analyzing`,
    updatedAt: Date.now(),
  });
}

export function recordTaskLiveResponding(taskId: string, runId: string, zh: boolean): void {
  const prev = liveActivities.get(taskId);
  if (prev && prev.runId !== runId) return;
  const stepCount = prev?.stepCount ?? 0;
  liveActivities.set(taskId, {
    taskId,
    runId,
    stage: 'responding',
    stepCount,
    summary: stepCount > 0
      ? (zh ? `正在汇总最终结果（已完成 ${stepCount} 步操作）` : `Composing result (${stepCount} steps completed)`)
      : (zh ? '正在生成结果' : 'Generating response'),
    updatedAt: Date.now(),
  });
}

export function clearTaskLiveActivity(taskId: string, runId?: string): void {
  const current = liveActivities.get(taskId);
  if (!current) return;
  if (!runId || current.runId === runId) {
    liveActivities.delete(taskId);
  }
}

export function getTaskLiveActivity(taskId: string, runId?: string): TaskLiveActivitySnapshot | undefined {
  const current = liveActivities.get(taskId);
  if (!current) return undefined;
  if (runId && current.runId !== runId) return undefined;
  return current;
}
