import type { XopcWorkspaceItem, XopcMobileTaskDetail, XopcMobileTaskReview,
  XopcMobileTaskRun, XopcMobileTaskReceipt, XopcMobileTaskCheck, XopcMobileTaskEvidence,
  XopcMobileTaskWait, XopcTaskAcceptanceCheck, XopcTaskCheckMutation, XopcTaskCommand, XopcTaskPatch } from '../model/workspace';

export function taskCriterionState(info: XopcMobileTaskDetail, criterion: string, index: number): string {
  const id = info.acceptanceChecks?.[index]?.id;
  if (!id) return 'pending';
  const review = info.criterionReviews.find((entry: XopcMobileTaskReview): boolean => entry.checkId === id);
  if (review) return review.status === 'unverified' ? 'pending' : review.status;
  if (info.contract?.acceptancePolicy === 'manual') return 'pending';
  const receipt = info.receipts.find((item: XopcMobileTaskReceipt): boolean => item.runId === info.acceptanceTarget?.runId);
  const matches = receipt?.verification.checks.filter((entry: XopcMobileTaskCheck): boolean =>
    entry.checkId === id && entry.criterion === criterion) ?? [];
  if (!receipt || matches.length !== 1) return 'pending';
  const check = matches[0];
  if (check.status === 'failed') return 'failed';
  return check.status === 'passed' && check.evidenceTitles.some((title: string): boolean => {
    const candidates = receipt.evidence.filter((item: XopcMobileTaskEvidence): boolean => item.title === title);
    return candidates.length === 1 && candidates[0].strength === 'verified';
  }) ? 'passed' : 'pending';
}

export function taskSignoffResult(item: XopcWorkspaceItem): string {
  const target = item.taskDetail?.acceptanceTarget;
  const primary = item.taskDetail?.presentation?.primaryAction;
  return target && target.canSignOff && primary?.type === 'signoff' && primary.resultId === target.id ? target.id : '';
}

export function taskReviewAction(item: XopcWorkspaceItem, checkId: string, status: string): string {
  const info = item.taskDetail;
  const target = info?.acceptanceTarget;
  if (!target || item.status === 'closed' || (info?.waits ?? []).some((wait: XopcMobileTaskWait): boolean => wait.status === 'active')) return '';
  return 'review:' + target.id + '|' + checkId + '|' + (status === 'passed' ? 'unverified' : 'passed');
}

export function taskReviewMutation(item: XopcWorkspaceItem, action: string): XopcTaskCheckMutation {
  const fields = action.slice('review:'.length).split('|');
  const info = item.taskDetail;
  if (!info || fields.length !== 3 || fields[0] !== info.acceptanceTarget?.id ||
    !info.acceptanceChecks?.some((check: XopcTaskAcceptanceCheck): boolean => check.id === fields[1]) ||
    !['passed', 'unverified'].includes(fields[2]) || item.status === 'closed' ||
    (info.waits ?? []).some((wait: XopcMobileTaskWait): boolean => wait.status === 'active')) throw new Error('INVALID_ACTION');
  return { expectedVersion: item.version, contractVersion: info.latestContractVersion, resultId: fields[0], status: fields[2] };
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
  if (phase === item.status || !['backlog', 'ready', 'active', 'review', 'closed'].includes(phase)) return '';
  return item.actions.includes('move') ? 'move:' + phase : '';
}

export function taskCommand(item: XopcWorkspaceItem, action: string, agentId: string): XopcTaskCommand {
  if (action.startsWith('signoff:')) {
    const resultId = action.slice('signoff:'.length);
    if (!resultId || taskSignoffResult(item) !== resultId) throw new Error('INVALID_ACTION');
    return { type: 'signoff', resultId };
  }
  const parts = action.split(':');
  const kind = parts[0] === 'cancel_task' ? 'close' : parts[0];
  if (!item.actions.includes(kind)) throw new Error('INVALID_ACTION');
  const command: XopcTaskCommand = { type: kind };
  if (kind === 'move' || kind === 'reopen') {
    const phase = parts[1] || (kind === 'reopen' ? 'backlog' : '');
    if (kind === 'move' ? !taskPhaseAction(item, phase)
      : item.status !== 'closed' || !['backlog', 'ready', 'active', 'review'].includes(phase)) throw new Error('INVALID_ACTION');
    command.phase = phase;
  } else if (kind === 'start') {
    if (!agentId.trim()) throw new Error('AGENT_REQUIRED');
    command.executor = { kind: 'agent', agentId: agentId.trim() };
  } else if (kind === 'close') {
    command.resolution = action === 'cancel_task' ? 'cancelled' : 'done';
  } else if (!['mark_ready', 'request_review'].includes(kind)) throw new Error('INVALID_ACTION');
  return command;
}

export function taskPatch(item: XopcWorkspaceItem): XopcTaskPatch {
  return { expectedVersion: item.version, title: item.title.trim(), body: item.body,
    projectId: item.projectId?.trim() || null, priority: item.priority || 'normal', dueAt: item.dueAt ?? null };
}
