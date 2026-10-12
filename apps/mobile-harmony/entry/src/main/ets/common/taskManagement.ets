import type { XopcWorkspaceItem, XopcMobileTaskDetail, XopcMobileTaskReview,
  XopcMobileTaskRun, XopcMobileTaskReceipt, XopcMobileTaskCheck, XopcMobileTaskEvidence,
  XopcMobileTaskWait, XopcTaskCommand, XopcTaskPatch } from '../model/workspace';

export function taskCriterionState(info: XopcMobileTaskDetail, criterion: string, index: number): string {
  const review = info.criterionReviews.find((entry: XopcMobileTaskReview): boolean =>
    entry.contractVersion === info.latestContractVersion && entry.criterionIndex === index);
  if (review && info.contract?.acceptancePolicy !== 'verified_auto') return review.status;
  if (info.contract?.acceptancePolicy === 'manual') return 'pending';
  const runIds = info.runs.filter((run: XopcMobileTaskRun): boolean => run.contractVersion === info.latestContractVersion)
    .map((run: XopcMobileTaskRun): string => run.id);
  const receipts = info.receipts.filter((receipt: XopcMobileTaskReceipt): boolean => runIds.includes(receipt.runId))
    .sort((left: XopcMobileTaskReceipt, right: XopcMobileTaskReceipt): number => right.finalizedAt - left.finalizedAt);
  for (const receipt of receipts) {
    const check = receipt.verification.checks.find((entry: XopcMobileTaskCheck): boolean => entry.criterion === criterion);
    if (!check || check.status === 'unverified') continue;
    if (check.status !== 'passed') return 'failed';
    return receipt.evidence.some((evidence: XopcMobileTaskEvidence): boolean => evidence.strength === 'verified'
      && (check.evidenceTitles ?? []).includes(evidence.title)) ? 'passed' : 'pending';
  }
  return 'pending';
}

export function taskCompletionBlock(item: XopcWorkspaceItem): string {
  const info = item.taskDetail;
  if (!info) return 'criteria';
  if ((info.waits ?? []).some((wait: XopcMobileTaskWait): boolean => wait.status === 'active')
    || info.runs.some((run: XopcMobileTaskRun): boolean => !run.parentRunId
      && ['queued', 'running', 'waiting', 'verifying'].includes(run.status ?? ''))) return 'execution';
  const criteria = info.contract?.acceptanceCriteria ?? [];
  if (!criteria.length) return 'criteria';
  return criteria.every((criterion: string, index: number): boolean =>
    taskCriterionState(info, criterion, index) === 'passed') ? '' : 'acceptance';
}

export function taskPhaseAction(item: XopcWorkspaceItem, phase: string): string {
  if (phase === item.status || !['backlog', 'ready', 'active', 'review'].includes(phase)) return '';
  if (item.status === 'closed') return item.actions.includes('reopen') ? 'reopen:' + phase : '';
  return item.actions.includes('move') ? 'move:' + phase : '';
}

export function taskCommand(item: XopcWorkspaceItem, action: string, agentId: string): XopcTaskCommand {
  const parts = action.split(':');
  const kind = parts[0] === 'cancel_task' ? 'close' : parts[0];
  if (!item.actions.includes(kind)) throw new Error('INVALID_ACTION');
  const command: XopcTaskCommand = { type: kind };
  if (kind === 'move' || kind === 'reopen') {
    const phase = parts[1] || (kind === 'reopen' ? 'backlog' : '');
    if (!taskPhaseAction(item, phase)) throw new Error('INVALID_ACTION');
    command.phase = phase;
  } else if (kind === 'start') {
    if (!agentId.trim()) throw new Error('AGENT_REQUIRED');
    command.executor = { kind: 'agent', agentId: agentId.trim() };
  } else if (kind === 'close') {
    if (action !== 'cancel_task' && taskCompletionBlock(item)) throw new Error('TASK_ACCEPTANCE_REQUIRED');
    command.resolution = action === 'cancel_task' ? 'cancelled' : 'done';
  } else if (!['mark_ready', 'request_review'].includes(kind)) throw new Error('INVALID_ACTION');
  return command;
}

export function taskPatch(item: XopcWorkspaceItem): XopcTaskPatch {
  return { expectedVersion: item.version, title: item.title.trim(), body: item.body,
    projectId: item.projectId?.trim() || null, priority: item.priority || 'normal', dueAt: item.dueAt ?? null };
}
