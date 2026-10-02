import { gatewaySession } from '../service/gatewaySession';
import { XopcProject, XopcProjectResult, XopcTaskList, XopcAutomationList, XopcWorkspaceItem } from '../model/workspace';
import { XopcNoteIndexEntry, XopcNoteList } from '../model/note';
import { taskItem, automationItem } from '../common/workspaceProtocol';

export interface XopcProjectTaskPage { items: XopcWorkspaceItem[]; total: number; }
export interface XopcProjectNotePage { items: XopcNoteIndexEntry[]; total: number; }

export class XopcProjectSpaceRepository {
  async project(id: string): Promise<XopcProject> {
    const result = JSON.parse(await gatewaySession.request('/api/projects/' + encodeURIComponent(id))) as XopcProjectResult;
    if (!result.project?.id || typeof result.project.name !== 'string') throw new Error('INVALID_PROJECT');
    return result.project;
  }

  async tasks(id: string, offset: number = 0): Promise<XopcProjectTaskPage> {
    const result = JSON.parse(await gatewaySession.request('/api/tasks?projectId=' + encodeURIComponent(id)
      + '&limit=30&offset=' + offset)) as XopcTaskList;
    if (!Array.isArray(result.items)) throw new Error('INVALID_TASK_LIST');
    return { items: result.items.map(taskItem), total: result.total ?? result.items.length };
  }

  async notes(id: string, offset: number = 0): Promise<XopcProjectNotePage> {
    const result = JSON.parse(await gatewaySession.request('/api/notes?projectId=' + encodeURIComponent(id)
      + '&limit=30&offset=' + offset + '&sortBy=updatedAt&sortOrder=desc')) as XopcNoteList;
    if (!Array.isArray(result.items)) throw new Error('INVALID_NOTE_LIST');
    return { items: result.items, total: result.total ?? result.items.length };
  }

  async automations(id: string): Promise<XopcWorkspaceItem[]> {
    const result = JSON.parse(await gatewaySession.request('/api/automations?projectId=' + encodeURIComponent(id))) as XopcAutomationList;
    if (!Array.isArray(result.automations)) throw new Error('INVALID_AUTOMATION_LIST');
    return result.automations.map(automationItem);
  }
}
