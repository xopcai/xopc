import { gatewaySession } from '../service/gatewaySession';
import { activeListScope, XopcListSnapshots } from '../service/listSnapshots';
import { XopcDeviceCrypto } from '../service/deviceCrypto';
import {
  XopcSection, XopcWorkspaceItem, XopcWorkspacePage, XopcTaskList, XopcProjectList,
  XopcAutomationList, XopcTaskResult, XopcProjectResult, XopcAutomationResult,
  XopcProjectWrite, XopcTaskCommandBody,
  XopcAutomationRuns, XopcAutomationRun, XopcAutomationRunResult, XopcMobileTaskDetailResult
} from '../model/workspace';
import { taskItem, taskDetailItem, projectItem, automationItem, newTask, scheduledAutomationPatch } from '../common/workspaceProtocol';
import { taskActiveRootRun, taskCommand, taskPatch, taskReviewMutation, taskRetryRunId } from '../common/taskManagement';

interface XopcCreatedWorkspaceId { id: string; }
interface XopcWorkspaceCreated {
  task?: XopcCreatedWorkspaceId; project?: XopcCreatedWorkspaceId;
}
interface XopcAutomationConfiguration { conversationId: string; }
interface XopcAutomationConfigurationScope { projectId?: string; personalLocale?: string; }
interface XopcWorkspaceTaskRetryBody { expectedRunId: string; idempotencyKey: string; }
interface XopcWorkspaceTaskRetryResult { status: string; }

const workspaceLists: XopcListSnapshots<XopcWorkspacePage> = new XopcListSnapshots<XopcWorkspacePage>();

export class XopcWorkspaceRepository {
  cachedList(section: XopcSection): XopcWorkspacePage | undefined {
    return workspaceLists.read(activeListScope(), section);
  }
  uuid(): string { return new XopcDeviceCrypto().uuid(); }
  async list(section: XopcSection, search: string, _offset: number = 0): Promise<XopcWorkspacePage> {
    const query = encodeURIComponent(search.trim());
    const scope = !query && _offset === 0 ? activeListScope() : '';
    const requestedAt = Date.now();
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
    }
    const page: XopcWorkspacePage = { items, hasMore };
    if (scope && scope === activeListScope()) workspaceLists.write(scope, section, page, requestedAt);
    return page;
  }

  async detail(section: XopcSection, id: string): Promise<XopcWorkspaceItem> {
    const raw = await gatewaySession.request('/api/' + section + '/' + encodeURIComponent(id));
    if (section === 'tasks') return taskDetailItem(JSON.parse(raw) as XopcMobileTaskDetailResult);
    if (section === 'projects') return projectItem((JSON.parse(raw) as XopcProjectResult).project);
    if (section === 'automations') return automationItem((JSON.parse(raw) as XopcAutomationResult).automation);
    throw new Error('INVALID_WORKSPACE_SECTION');
  }

  async openAutomationConfiguration(projectId: string = '', personalLocale: string = ''): Promise<string> {
    const scope: XopcAutomationConfigurationScope = {};
    if (projectId) scope.projectId = projectId;
    if (personalLocale) scope.personalLocale = personalLocale.startsWith('zh') ? 'zh' : 'en';
    const result = JSON.parse(await gatewaySession.request('/api/automations/configuration-conversations', 'POST',
      JSON.stringify(scope))) as XopcAutomationConfiguration;
    if (typeof result.conversationId !== 'string' || !result.conversationId.trim()) throw new Error('INVALID_AUTOMATION_CONFIGURATION');
    return result.conversationId;
  }

  async save(section: XopcSection, item: XopcWorkspaceItem, idempotencyKey: string): Promise<string> {
    const create = !item.id;
    const path = '/api/' + section + (create ? '' : '/' + encodeURIComponent(item.id));
    let body: string;
    if (section === 'tasks') {
      const captured = newTask(item.title, item.body, idempotencyKey, item.projectId);
      captured.priority = item.priority || 'normal'; captured.dueAt = item.dueAt;
      body = JSON.stringify(create ? captured : taskPatch(item));
    } else if (section === 'projects') {
      const patch: XopcProjectWrite = { name: item.title.trim(), description: item.body }; body = JSON.stringify(patch);
    } else if (section === 'automations') {
      if (create || !item.editable || !item.automation) throw new Error('AUTOMATION_NOT_MOBILE_EDITABLE');
      body = JSON.stringify(scheduledAutomationPatch(item.title, item.body, item.cron ?? '', item.automation, item.automationTimeZone));
    } else throw new Error('INVALID_WORKSPACE_SECTION');
    const response = await gatewaySession.request(path, create ? 'POST' : 'PATCH', body,
      create && section !== 'tasks' ? idempotencyKey : '');
    if (!create) return item.id;
    const raw = JSON.parse(response) as XopcWorkspaceCreated;
    const id = raw.task?.id || raw.project?.id;
    if (!id) throw new Error('INVALID_WORKSPACE_RESPONSE');
    return id;
  }

  async action(section: XopcSection, item: XopcWorkspaceItem, action: string, agentId: string, idempotencyKey: string): Promise<void> {
    const path = '/api/' + section + '/' + encodeURIComponent(item.id);
    if (section === 'tasks') {
      if (action === 'stop_run') {
        const activeRun = taskActiveRootRun(item);
        if (!activeRun || !activeRun.version) throw new Error('INVALID_ACTION');
        await gatewaySession.request('/api/task-runs/' + encodeURIComponent(activeRun.id) + '/cancel', 'POST',
          JSON.stringify({ expectedVersion: activeRun.version, reason: 'Cancelled from mobile' }));
        return;
      }
      if (action.startsWith('review:')) {
        const mutation = taskReviewMutation(item, action);
        const checkId = action.slice('review:'.length).split('|')[1];
        await gatewaySession.request(path + '/criteria/' + encodeURIComponent(checkId) + '/review', 'PUT', JSON.stringify(mutation));
        return;
      }
      const command = taskCommand(item, action, agentId);
      const body: XopcTaskCommandBody = { idempotencyKey, expectedVersion: item.version, command, source: 'mobile' };
      await gatewaySession.request(path + '/commands', 'POST', JSON.stringify(body));
    } else if (section === 'projects') {
      if (action === 'archive' || action === 'activate') {
        const body: XopcProjectWrite = { status: action === 'archive' ? 'archived' : 'active' };
        await gatewaySession.request(path, 'PATCH', JSON.stringify(body));
      } else if (action === 'pin' || action === 'unpin') await gatewaySession.request(path + '/' + action, 'POST', '{}');
      else throw new Error('INVALID_ACTION');
    } else if (section === 'automations' && ['pause', 'resume'].includes(action)) {
      const body = item.version > 0 ? JSON.stringify({ expectedRevision: item.version }) : '{}';
      await gatewaySession.request(path + '/' + action, 'POST', body, item.version > 0 ? idempotencyKey : '');
    } else if (section === 'automations' && action === 'delete') {
      const body = item.version > 0 ? JSON.stringify({ expectedRevision: item.version }) : '{}';
      await gatewaySession.request(path, 'DELETE', body, item.version > 0 ? idempotencyKey : '');
    } else throw new Error('INVALID_ACTION');
  }

  async retryTask(id: string): Promise<void> {
    if (!id.trim()) throw new Error('INVALID_HOME_ACTION');
    const path = '/api/tasks/' + encodeURIComponent(id);
    const connection = gatewaySession.connectionRevision();
    const raw = await gatewaySession.request(path);
    gatewaySession.assertConnection(connection);
    const detail = JSON.parse(raw) as XopcMobileTaskDetailResult;
    const body: XopcWorkspaceTaskRetryBody = { expectedRunId: taskRetryRunId(detail), idempotencyKey: this.uuid() };
    const result = JSON.parse(await gatewaySession.request(path + '/retry', 'POST', JSON.stringify(body))) as XopcWorkspaceTaskRetryResult;
    if (!['queued', 'running', 'waiting', 'verifying', 'succeeded', 'waiting_connection'].includes(result.status)) {
      throw new Error('TASK_RETRY_UNAVAILABLE');
    }
  }

  async startAutomation(id: string, idempotencyKey: string): Promise<string> {
    const result = JSON.parse(await gatewaySession.request('/api/automations/' + encodeURIComponent(id) + '/run', 'POST', '{}', idempotencyKey)) as XopcAutomationRunResult;
    if (!result.run?.id) throw new Error('INVALID_AUTOMATION_RUN');
    return result.run.id;
  }

  async runs(id: string): Promise<XopcAutomationRun[]> {
    const result = JSON.parse(await gatewaySession.request('/api/automation-runs?limit=30&automationId=' + encodeURIComponent(id))) as XopcAutomationRuns;
    if (!Array.isArray(result.runs)) throw new Error('INVALID_RUNS');
    return result.runs;
  }
}
