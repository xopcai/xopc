import { gatewaySession } from '../service/gatewaySession';
import { XopcDeviceCrypto } from '../service/deviceCrypto';
import {
  XopcSection, XopcWorkspaceItem, XopcWorkspacePage, XopcTaskList, XopcProjectList,
  XopcAutomationList, XopcNoteList, XopcTaskResult, XopcProjectResult, XopcAutomationResult, XopcNoteResult,
  XopcTaskPatch, XopcProjectWrite, XopcNoteWrite, XopcTaskCommandBody, XopcTaskCommand,
  XopcAutomationRuns, XopcAutomationRun
} from '../model/workspace';
import { taskItem, projectItem, automationItem, noteItem, newTask, scheduledAutomation } from '../common/workspaceProtocol';

export class XopcWorkspaceRepository {
  uuid(): string { return new XopcDeviceCrypto().uuid(); }
  async list(section: XopcSection, search: string, offset: number = 0, noteStatus: string = ''): Promise<XopcWorkspacePage> {
    const query = encodeURIComponent(search.trim());
    let items: XopcWorkspaceItem[] = [];
    let hasMore: boolean = false;
    if (section === 'tasks') {
      const result = JSON.parse(await gatewaySession.request('/api/tasks?search=' + query)) as XopcTaskList;
      if (!Array.isArray(result.items)) throw new Error('INVALID_TASK_LIST');
      items = result.items.map(taskItem);
    } else if (section === 'projects') {
      const result = JSON.parse(await gatewaySession.request('/api/projects?limit=100&sortBy=updatedAt&sortOrder=desc&includeOperating=true')) as XopcProjectList;
      if (!Array.isArray(result.items)) throw new Error('INVALID_PROJECT_LIST');
      items = result.items.map(projectItem).filter((item): boolean => item.title.toLowerCase().includes(search.toLowerCase()));
    } else if (section === 'automations') {
      const result = JSON.parse(await gatewaySession.request('/api/automations')) as XopcAutomationList;
      if (!Array.isArray(result.automations)) throw new Error('INVALID_AUTOMATION_LIST');
      items = result.automations.map(automationItem).filter((item): boolean => item.title.toLowerCase().includes(search.toLowerCase()));
    } else {
      const result = JSON.parse(await gatewaySession.request('/api/notes?limit=30&offset=' + offset + '&sortBy=updatedAt&sortOrder=desc&search=' + query + (noteStatus ? '&status=' + encodeURIComponent(noteStatus) : ''))) as XopcNoteList;
      if (!Array.isArray(result.items)) throw new Error('INVALID_NOTE_LIST');
      items = result.items.map(noteItem); hasMore = result.hasMore ?? false;
    }
    return { items, hasMore };
  }

  async detail(section: XopcSection, id: string): Promise<XopcWorkspaceItem> {
    const raw = await gatewaySession.request('/api/' + section + '/' + encodeURIComponent(id));
    if (section === 'tasks') return taskItem(JSON.parse(raw) as XopcTaskResult);
    if (section === 'projects') return projectItem((JSON.parse(raw) as XopcProjectResult).project);
    if (section === 'automations') return automationItem((JSON.parse(raw) as XopcAutomationResult).automation);
    return noteItem((JSON.parse(raw) as XopcNoteResult).note);
  }

  async save(section: XopcSection, item: XopcWorkspaceItem, idempotencyKey: string): Promise<void> {
    const create = !item.id;
    const path = '/api/' + section + (create ? '' : '/' + encodeURIComponent(item.id));
    let body: string;
    if (section === 'tasks') {
      const patch: XopcTaskPatch = { expectedVersion: item.version, title: item.title.trim(), body: item.body, projectId: item.projectId };
      body = JSON.stringify(create ? newTask(item.title, item.body, idempotencyKey, item.projectId) : patch);
    } else if (section === 'projects') {
      const patch: XopcProjectWrite = { name: item.title.trim(), description: item.body }; body = JSON.stringify(patch);
    } else if (section === 'automations') {
      if (!item.editable) throw new Error('AUTOMATION_NOT_MOBILE_EDITABLE');
      body = JSON.stringify(scheduledAutomation(item.title, item.body, item.cron ?? '', create, item.automation));
    } else {
      const patch: XopcNoteWrite = { title: item.title.trim(), markdown: item.body };
      if (create) { patch.kind = 'thought'; patch.channel = 'app'; patch.platform = 'harmonyos'; }
      body = JSON.stringify(patch);
    }
    await gatewaySession.request(path, create ? 'POST' : 'PATCH', body);
  }

  async action(section: XopcSection, item: XopcWorkspaceItem, action: string, agentId: string, idempotencyKey: string): Promise<void> {
    const path = '/api/' + section + '/' + encodeURIComponent(item.id);
    if (section === 'tasks') {
      if (!['mark_ready', 'start', 'request_review', 'close', 'reopen'].includes(action)) throw new Error('INVALID_ACTION');
      const command: XopcTaskCommand = { type: action };
      if (action === 'start') { if (!agentId.trim()) throw new Error('AGENT_REQUIRED'); command.executor = { kind: 'agent', agentId: agentId.trim() }; }
      if (action === 'close') command.resolution = 'done';
      if (action === 'reopen') command.phase = 'backlog';
      const body: XopcTaskCommandBody = { idempotencyKey, expectedVersion: item.version, command };
      await gatewaySession.request(path + '/commands', 'POST', JSON.stringify(body));
    } else if (section === 'projects') {
      if (action === 'archive' || action === 'activate') {
        const body: XopcProjectWrite = { status: action === 'archive' ? 'archived' : 'active' };
        await gatewaySession.request(path, 'PATCH', JSON.stringify(body));
      } else if (action === 'pin' || action === 'unpin') await gatewaySession.request(path + '/' + action, 'POST', '{}');
      else throw new Error('INVALID_ACTION');
    } else if (section === 'automations' && ['run', 'pause', 'resume'].includes(action)) {
      await gatewaySession.request(path + '/' + action, 'POST', '{}');
    } else if ((section === 'notes' || section === 'automations') && action === 'delete') {
      await gatewaySession.request(path, 'DELETE');
    } else throw new Error('INVALID_ACTION');
  }

  async runs(id: string): Promise<XopcAutomationRun[]> {
    const result = JSON.parse(await gatewaySession.request('/api/automation-runs?limit=30&automationId=' + encodeURIComponent(id))) as XopcAutomationRuns;
    if (!Array.isArray(result.runs)) throw new Error('INVALID_RUNS');
    return result.runs;
  }
}
