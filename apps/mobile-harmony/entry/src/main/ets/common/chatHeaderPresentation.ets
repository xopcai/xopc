import { XopcContextDelegatedTask, XopcContextSummary } from '../model/chat';

export interface XopcChatContextStrip {
  hasProject: boolean;
  projectTitle: string;
  taskText: string;
  environmentTag: string;
  needsAttention: boolean;
  isTaskActive: boolean;
  summaryText: string;
}

const ATTENTION_STATES: string[] = ['review', 'failed', 'blocked', 'needsuser', 'needs_user', 'waiting_for_user'];
const ACTIVE_STATES: string[] = ['running', 'active', 'in_progress', 'verifying', 'queued', 'allocating'];

export function shortThinkingLabel(level: string, isZh: boolean): string {
  const normalized = level.trim().toLowerCase();
  if (!normalized || normalized === 'off' || normalized === 'none') return '';
  if (normalized === 'minimal') return isZh ? '极低' : 'Min';
  if (normalized === 'low') return isZh ? '低' : 'Low';
  if (normalized === 'medium') return isZh ? '中' : 'Med';
  if (normalized === 'high') return isZh ? '高' : 'High';
  if (normalized === 'xhigh') return isZh ? '极高' : 'XHigh';
  if (normalized === 'max') return isZh ? '最高' : 'Max';
  return level.trim();
}

export function chatModelSubtitle(
  modelName: string,
  thinkingMode: string | undefined,
  thinkingLevel: string,
  fastEnabled: boolean,
  language: string,
): string {
  const trimmed = modelName.trim();
  if (!trimmed) return '';
  const isZh = language.startsWith('zh');
  const parts: string[] = [trimmed];
  if (thinkingMode === 'levels' || thinkingMode === 'toggle') {
    const effort = shortThinkingLabel(thinkingLevel, isZh);
    if (effort) parts.push(effort);
  }
  let result = parts.join(' · ');
  if (fastEnabled) result += ' ⚡';
  return result;
}

export function localizedTaskPhase(phase: string | undefined, isZh: boolean): string {
  const normalized = (phase ?? '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'review') return isZh ? '待验收' : 'Review';
  if (normalized === 'failed') return isZh ? '失败' : 'Failed';
  if (normalized === 'blocked') return isZh ? '受阻' : 'Blocked';
  if (normalized === 'needsuser' || normalized === 'needs_user' || normalized === 'waiting_for_user') {
    return isZh ? '待处理' : 'Needs you';
  }
  if (normalized === 'running' || normalized === 'active' || normalized === 'in_progress') {
    return isZh ? '进行中' : 'Active';
  }
  if (normalized === 'verifying') return isZh ? '验证中' : 'Verifying';
  if (normalized === 'queued') return isZh ? '排队中' : 'Queued';
  if (normalized === 'ready') return isZh ? '待开始' : 'Ready';
  if (normalized === 'backlog' || normalized === 'captured') return isZh ? '待规划' : 'Backlog';
  if (normalized === 'waiting') return isZh ? '等待中' : 'Waiting';
  if (normalized === 'paused') return isZh ? '已暂停' : 'Paused';
  if (normalized === 'completed' || normalized === 'done') return isZh ? '已完成' : 'Done';
  if (normalized === 'closed' || normalized === 'ended') return isZh ? '已结束' : 'Closed';
  if (normalized === 'cancelled') return isZh ? '已取消' : 'Cancelled';
  return '';
}

export function chatContextStrip(
  summary: XopcContextSummary | undefined,
  scopedProjectName: string,
  language: string,
): XopcChatContextStrip | undefined {
  const projectTitle = (summary?.work.project?.title || scopedProjectName || '').trim();
  const taskTitle = (summary?.work.task?.title || '').trim();
  const taskPhase = (summary?.work.task?.phase || '').trim();
  const delegatedTasks: XopcContextDelegatedTask[] = summary?.work.delegatedTasks ?? [];
  const delegatedCount = Math.max(summary?.work.delegatedTaskCount ?? 0, delegatedTasks.length);

  if (!projectTitle && !taskTitle && delegatedCount <= 0) {
    return undefined;
  }

  const isZh = language.startsWith('zh');
  let taskText = '';
  let needsAttention = false;
  let isTaskActive = false;

  if (taskTitle) {
    const phaseLabel = localizedTaskPhase(taskPhase, isZh);
    taskText = phaseLabel ? `${taskTitle} · ${phaseLabel}` : taskTitle;
    const lower = taskPhase.toLowerCase();
    needsAttention = ATTENTION_STATES.includes(lower);
    isTaskActive = ACTIVE_STATES.includes(lower);
  } else if (delegatedCount > 0) {
    const attentionCount = delegatedTasks.filter((item: XopcContextDelegatedTask): boolean => {
      const phaseLower = (item.phase || '').toLowerCase();
      const runLower = (item.runStatus || '').toLowerCase();
      return ATTENTION_STATES.includes(phaseLower) || ATTENTION_STATES.includes(runLower);
    }).length;
    const activeCount = delegatedTasks.filter((item: XopcContextDelegatedTask): boolean => {
      const phaseLower = (item.phase || '').toLowerCase();
      const runLower = (item.runStatus || '').toLowerCase();
      return ACTIVE_STATES.includes(phaseLower) || ACTIVE_STATES.includes(runLower);
    }).length;
    needsAttention = attentionCount > 0;
    isTaskActive = activeCount > 0;
    if (attentionCount > 0) {
      taskText = isZh
        ? `${delegatedCount} 项任务 · ${attentionCount} 待处理`
        : `${delegatedCount} tasks · ${attentionCount} needs you`;
    } else {
      taskText = isZh
        ? `${delegatedCount} 项派出任务`
        : `${delegatedCount} ${delegatedCount === 1 ? 'task' : 'tasks'}`;
    }
  }

  let environmentTag = '';
  if (!taskText && projectTitle) {
    const branch = (summary?.environment?.branch || '').trim();
    if (summary?.environment?.kind === 'managed_worktree') {
      environmentTag = branch ? `Worktree · ${branch}` : 'Worktree';
    } else if (branch) {
      environmentTag = branch;
    }
  }

  const summaryParts: string[] = [];
  if (projectTitle) summaryParts.push(projectTitle);
  if (taskText) summaryParts.push(taskText);
  if (environmentTag) summaryParts.push(environmentTag);

  return {
    hasProject: projectTitle.length > 0,
    projectTitle,
    taskText,
    environmentTag,
    needsAttention,
    isTaskActive,
    summaryText: summaryParts.join(' · '),
  };
}

export function shouldShowRuntimeBadge(agentName: string, badge: string): boolean {
  const trimmed = badge.trim();
  if (!trimmed) return false;
  return !agentName.toLowerCase().includes(trimmed.toLowerCase());
}
