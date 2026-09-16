import type {
  XopcTaskResult, XopcProject, XopcAutomation, XopcNote, XopcWorkspaceItem,
  XopcTaskCreate, XopcAutomationWrite
} from '../model/workspace';

export function taskItem(result: XopcTaskResult): XopcWorkspaceItem {
  const task = result.task;
  if (!task?.id || typeof task.title !== 'string' || !Number.isInteger(task.version)) throw new Error('INVALID_TASK');
  return { id: task.id, title: task.title, body: task.body ?? '', status: task.phase, version: task.version,
    projectId: task.projectId, editable: true, actions: result.allowedCommands ?? [] };
}
export function projectItem(project: XopcProject): XopcWorkspaceItem {
  if (!project?.id || typeof project.name !== 'string') throw new Error('INVALID_PROJECT');
  return { id: project.id, title: project.name, body: project.description ?? '', status: project.status,
    version: 0, editable: true, actions: ['pin', 'unpin', project.status === 'archived' ? 'activate' : 'archive'] };
}
export function automationItem(automation: XopcAutomation): XopcWorkspaceItem {
  if (!automation?.id || !automation.trigger || !automation.action) throw new Error('INVALID_AUTOMATION');
  return { id: automation.id, title: automation.name, body: automation.action.instruction ?? '',
    status: automation.enabled ? 'enabled' : 'paused', version: 0, enabled: automation.enabled,
    cron: automation.trigger.schedule?.expr ?? '', editable: automation.trigger.kind === 'schedule'
      && automation.trigger.schedule?.kind === 'cron' && automation.action.kind === 'agent',
    actions: ['run', automation.enabled ? 'pause' : 'resume', 'delete'], automation };
}
export function noteItem(note: XopcNote): XopcWorkspaceItem {
  if (!note?.id) throw new Error('INVALID_NOTE');
  return { id: note.id, title: note.title ?? '', body: note.markdown ?? note.snippet ?? '', status: note.status,
    version: note.remoteVersion ?? 0, editable: true, actions: ['delete'] };
}
export function newTask(title: string, body: string, idempotencyKey: string, projectId?: string): XopcTaskCreate {
  return { title: title.trim(), body, idempotencyKey, projectId,
    contract: { objective: body.trim() || title.trim(), expectedOutputs: [], acceptanceCriteria: [], constraints: [],
      approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'manual', outputDestinations: [] },
    activation: { mode: 'capture', phase: 'backlog' } };
}
export function scheduledAutomation(title: string, body: string, cron: string, create: boolean, existing?: XopcAutomation): XopcAutomationWrite {
  const result: XopcAutomationWrite = { name: title.trim(), trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: cron.trim() } },
    action: { kind: 'agent', instruction: body.trim() } };
  if (create) { result.enabled = true; result.conversationMode = 'new_session'; result.notificationPolicy = 'attention'; }
  else if (existing) {
    const original = JSON.parse(JSON.stringify(existing)) as XopcAutomation;
    if (original.trigger.kind !== 'schedule' || original.trigger.schedule?.kind !== 'cron' || original.action.kind !== 'agent') {
      throw new Error('AUTOMATION_NOT_MOBILE_EDITABLE');
    }
    original.trigger.schedule.expr = cron.trim(); original.action.instruction = body.trim();
    result.trigger = original.trigger; result.action = original.action;
  }
  return result;
}
