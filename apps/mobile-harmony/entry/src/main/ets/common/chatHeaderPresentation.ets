import { XopcContextDelegatedTask, XopcContextSummary } from '../model/chat';

export interface XopcChatHeaderModelParts {
  name: string;
  suffix: string;
  fullText: string;
}

export interface XopcChatHeaderIdentity {
  hasConversationTitle: boolean;
  showsAvatarInPrimary: boolean;
  primaryText: string;
  primaryRuntimeBadge: string;
  showsAgentInSecondary: boolean;
  secondaryAgentName: string;
  secondaryRuntimeBadge: string;
  modelName: string;
  modelSuffix: string;
  hasSecondaryRow: boolean;
  accessibilitySummary: string;
}

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

export function chatModelSubtitleParts(
  modelName: string,
  thinkingMode: string | undefined,
  thinkingLevel: string,
  fastEnabled: boolean,
  language: string,
): XopcChatHeaderModelParts | undefined {
  const trimmed = modelName.trim();
  if (!trimmed) return undefined;
  const isZh = language.startsWith('zh');
  let effort = '';
  if (thinkingMode === 'levels' || thinkingMode === 'toggle') {
    effort = shortThinkingLabel(thinkingLevel, isZh);
  }
  let suffix = '';
  if (effort && fastEnabled) suffix = `· ${effort} ⚡`;
  else if (effort) suffix = `· ${effort}`;
  else if (fastEnabled) suffix = '⚡';
  return {
    name: trimmed,
    suffix,
    fullText: suffix ? `${trimmed} ${suffix}` : trimmed,
  };
}

export function chatModelSubtitle(
  modelName: string,
  thinkingMode: string | undefined,
  thinkingLevel: string,
  fastEnabled: boolean,
  language: string,
): string {
  return chatModelSubtitleParts(modelName, thinkingMode, thinkingLevel, fastEnabled, language)?.fullText ?? '';
}

export function chatHeaderIdentity(
  conversationTitle: string,
  isDraft: boolean,
  agentId: string,
  defaultAgentId: string,
  agentName: string,
  runtimeBadge: string,
  modelParts: XopcChatHeaderModelParts | undefined,
): XopcChatHeaderIdentity {
  const trimmedTitle = conversationTitle.trim();
  const hasConversationTitle = !isDraft && trimmedTitle.length > 0;
  const trimmedAgent = agentName.trim();
  const shownBadge = shouldShowRuntimeBadge(trimmedAgent, runtimeBadge) ? runtimeBadge.trim() : '';
  const normalizedAgent = agentId.trim().toLowerCase();
  const normalizedDefault = defaultAgentId.trim().toLowerCase() || 'main';
  const isDefaultAgent = !normalizedAgent || normalizedAgent === normalizedDefault;
  const showsAgentInSecondary = hasConversationTitle && !isDefaultAgent && trimmedAgent.length > 0;
  const modelName = modelParts?.name ?? '';
  const modelSuffix = modelParts?.suffix ?? '';
  const summaryParts: string[] = [];
  const primaryText = hasConversationTitle ? trimmedTitle : trimmedAgent;
  if (primaryText) summaryParts.push(primaryText);
  if (showsAgentInSecondary) summaryParts.push(trimmedAgent);
  if (modelParts?.fullText) summaryParts.push(modelParts.fullText);
  return {
    hasConversationTitle,
    showsAvatarInPrimary: !hasConversationTitle,
    primaryText,
    primaryRuntimeBadge: hasConversationTitle ? '' : shownBadge,
    showsAgentInSecondary,
    secondaryAgentName: showsAgentInSecondary ? trimmedAgent : '',
    secondaryRuntimeBadge: showsAgentInSecondary ? shownBadge : '',
    modelName,
    modelSuffix,
    hasSecondaryRow: showsAgentInSecondary || modelName.length > 0,
    accessibilitySummary: summaryParts.join('，'),
  };
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
