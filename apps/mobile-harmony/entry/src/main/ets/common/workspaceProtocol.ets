import type {
  XopcTaskResult, XopcMobileTaskDetailResult, XopcProject, XopcAutomation, XopcWorkspaceItem,
  XopcTaskCreate, XopcAutomationWrite, XopcTrigger, XopcAutomationAction
} from '../model/workspace';

export function taskItem(result: XopcTaskResult): XopcWorkspaceItem {
  const task = result.task;
  if (!task?.id || typeof task.title !== 'string' || !Number.isInteger(task.version)) throw new Error('INVALID_TASK');
  return { id: task.id, title: task.title, body: task.body ?? '', status: task.phase, version: task.version,
    projectId: task.projectId, priority: task.priority, dueAt: task.dueAt, resolution: task.resolution, updatedAt: task.updatedAt,
    editable: true, actions: result.allowedCommands ?? [] };
}
export function taskDetailItem(result: XopcMobileTaskDetailResult): XopcWorkspaceItem {
  const item = taskItem(result);
  item.taskDetail = {
    contract: result.task.contract, latestContractVersion: result.task.latestContractVersion ?? 0,
    phaseChanges: result.phaseChanges ?? [], operationalState: result.operationalState, waits: result.waits ?? [],
    attention: result.attention ?? [], criterionReviews: result.criterionReviews ?? [],
    acceptanceChecks: result.acceptanceChecks ?? [], acceptanceTarget: result.acceptanceTarget, presentation: result.presentation,
    receipts: result.receipts ?? [], context: result.context ?? [], sessions: result.sessions ?? [],
    dependencies: result.dependencies ?? [], dependents: result.dependents ?? [], runs: result.runs ?? [],
    activeConversationId: result.conversation?.activeConversationId
  };
  return item;
}
export function projectItem(project: XopcProject): XopcWorkspaceItem {
  if (!project?.id || typeof project.name !== 'string') throw new Error('INVALID_PROJECT');
  return { id: project.id, title: project.name, body: project.description ?? '', status: project.status,
    version: 0, brief: project.brief, outcome: project.outcome, editable: true,
    actions: ['pin', 'unpin', project.status === 'archived' ? 'activate' : 'archive'] };
}
export function automationItem(automation: XopcAutomation): XopcWorkspaceItem {
  if (!automation?.id || !automation.trigger || !automation.action) throw new Error('INVALID_AUTOMATION');
  const actions: string[] = [];
  if (automation.management?.runnable !== false) actions.push('run');
  if (!automation.management || automation.management.editable.includes('enabled')) actions.push(automation.enabled ? 'pause' : 'resume');
  if (automation.management?.deletable !== false) actions.push('delete');
  return { id: automation.id, title: automation.name, body: automation.action.instruction ?? '',
    status: automation.enabled ? 'enabled' : 'paused', version: automation.updatedAtMs ?? 0, enabled: automation.enabled, projectId: automation.projectId,
    cron: automation.trigger.schedule?.expr ?? '', automationTimeZone: automation.trigger.schedule?.tz, editable: !automation.management && automation.trigger.kind === 'schedule'
      && automation.trigger.schedule?.kind === 'cron' && automation.action.kind === 'agent',
    actions, automation };
}
export function newTask(title: string, body: string, idempotencyKey: string, projectId?: string): XopcTaskCreate {
  return { title: title.trim(), body, idempotencyKey, projectId,
    contract: { objective: body.trim() || title.trim(), expectedOutputs: [], acceptanceCriteria: [], constraints: [],
      approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'manual', outputDestinations: [] },
    activation: { mode: 'capture', phase: 'backlog' } };
}
export function scheduledAutomationPatch(title: string, body: string, cron: string, existing: XopcAutomation,
  timeZone?: string): XopcAutomationWrite {
  const trigger = JSON.parse(JSON.stringify(existing.trigger)) as XopcTrigger;
  const action = JSON.parse(JSON.stringify(existing.action)) as XopcAutomationAction;
  const schedule = trigger.schedule;
  if (trigger.kind !== 'schedule' || schedule?.kind !== 'cron' || action.kind !== 'agent') {
    throw new Error('AUTOMATION_NOT_MOBILE_EDITABLE');
  }
  schedule.expr = cron.trim();
  if (timeZone !== undefined) schedule.tz = timeZone.trim() || undefined;
  action.instruction = body.trim();
  return { name: title.trim(), expectedRevision: existing.updatedAtMs, trigger, action };
}
