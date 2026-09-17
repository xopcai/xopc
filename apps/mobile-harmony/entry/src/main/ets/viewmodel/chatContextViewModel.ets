import { gatewaySession } from '../service/gatewaySession';
import { XopcPayload } from '../model/realtime';
import { XopcProject, XopcProjectList, XopcNoteList, XopcTaskList } from '../model/workspace';
import { XopcFileSpaceResult, XopcFiles } from '../model/files';
import { XopcContextSummary, XopcContextResult, XopcEnvironmentOptions, XopcEnvironmentResult,
  XopcHostDirectories, XopcWorkingDirectory, XopcAgentConfig, XopcReferenceItem } from '../model/chat';

@ObservedV2
export class XopcChatContextViewModel {
  @Trace summary?: XopcContextSummary;
  @Trace projects: XopcProject[] = [];
  @Trace environment?: XopcEnvironmentOptions;
  @Trace directories?: XopcHostDirectories;
  @Trace config?: XopcAgentConfig;
  @Trace references: XopcReferenceItem[] = [];
  @Trace loading: boolean = false;
  @Trace error: string = '';
  private conversationId: string = '';
  private generation: number = 0;
  dispose(): void { this.generation++; }
  setReferenceConversation(id: string): void { this.generation++; this.conversationId = id; this.references = []; }
  async load(id: string): Promise<void> {
    this.conversationId = id; this.summary = undefined; this.config = undefined;
    const generation = ++this.generation; this.loading = true; this.error = '';
    try {
      const result = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/context-summary')) as XopcContextResult;
      if (!result.summary || result.summary.conversationId !== id) throw new Error('INVALID_CONTEXT');
      if (generation !== this.generation) return;
      this.summary = result.summary;
      const config = JSON.parse(await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/agent-config')) as XopcPayload<XopcAgentConfig>;
      if (generation === this.generation) this.config = config.payload;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
  async choices(mode: string): Promise<void> {
    const generation = ++this.generation; this.loading = true; this.error = '';
    try {
      if (mode === 'project') {
        const result = JSON.parse(await gatewaySession.request('/api/projects')) as XopcProjectList;
        if (!Array.isArray(result.items)) throw new Error('INVALID_PROJECTS');
        if (generation === this.generation) this.projects = result.items.filter((item: XopcProject): boolean => item.status !== 'archived');
      } else if (this.summary?.work.project) {
        const result = JSON.parse(await gatewaySession.request('/api/projects/' + encodeURIComponent(this.summary.work.project.id) + '/environment-options')) as XopcEnvironmentResult;
        if (!result.options) throw new Error('INVALID_ENVIRONMENT_OPTIONS');
        if (generation === this.generation) this.environment = result.options;
      }
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
  async browse(path: string): Promise<void> {
    const generation = ++this.generation; this.loading = true; this.error = ''; this.directories = undefined;
    try {
      const result = JSON.parse(await gatewaySession.request('/api/host/fs/list' + (path ? '?path=' + encodeURIComponent(path) : ''))) as XopcPayload<XopcHostDirectories>;
      if (!Array.isArray(result.payload?.entries)) throw new Error('INVALID_DIRECTORIES');
      if (generation === this.generation) this.directories = result.payload;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
  async setDirectory(): Promise<boolean> {
    if (!this.directories?.currentPath || this.config?.workingDirectoryLocked || this.loading) return false;
    const generation = ++this.generation; const id = this.conversationId; this.loading = true; this.error = '';
    try {
      const body: XopcWorkingDirectory = { workingDirectory: this.directories.currentPath };
      await gatewaySession.request('/api/sessions/' + encodeURIComponent(id) + '/agent-config', 'PATCH', JSON.stringify(body));
      if (generation !== this.generation) return false;
      await this.load(id); return true;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; return false; }
    finally { if (generation === this.generation) this.loading = false; }
  }
  async searchReferences(kind: string, search: string, path: string = ''): Promise<void> {
    const generation = ++this.generation; this.loading = true; this.error = ''; this.references = [];
    try {
      let items: XopcReferenceItem[] = [];
      if (kind === 'note') {
        const result = JSON.parse(await gatewaySession.request('/api/notes?limit=50&sortBy=updatedAt&sortOrder=desc&search=' + encodeURIComponent(search))) as XopcNoteList;
        items = result.items.filter((note): boolean => note.status !== 'trashed' && note.updatedAt !== undefined)
          .map((note): XopcReferenceItem => ({ kind, id: note.id, title: note.title || note.snippet || '', description: note.snippet || '', version: String(note.updatedAt) }));
      } else if (kind === 'task') {
        const result = JSON.parse(await gatewaySession.request('/api/tasks?search=' + encodeURIComponent(search))) as XopcTaskList;
        items = result.items.map((item): XopcReferenceItem => ({ kind, id: item.task.id, title: item.task.title, description: item.task.body || '', version: String(item.task.version) }));
      } else if (kind === 'file') {
        const space = JSON.parse(await gatewaySession.request('/api/files/contexts/session/' + encodeURIComponent(this.conversationId))) as XopcFileSpaceResult;
        if (generation !== this.generation) return;
        if (!space.space?.id) throw new Error('INVALID_FILE_SPACE');
        const result = JSON.parse(await gatewaySession.request(search ? '/api/files/search?limit=50&spaceId=' + encodeURIComponent(space.space.id) + '&q=' + encodeURIComponent(search)
          : '/api/files/spaces/' + encodeURIComponent(space.space.id) + '/children?path=' + encodeURIComponent(path))) as XopcFiles;
        items = result.items.map((file): XopcReferenceItem => ({ kind, id: file.id, title: file.name, description: file.relativePath,
          version: file.revision, relativePath: file.relativePath, directory: file.kind === 'directory', mimeType: file.mimeType, size: file.size }));
      }
      if (generation === this.generation) this.references = items;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
}
