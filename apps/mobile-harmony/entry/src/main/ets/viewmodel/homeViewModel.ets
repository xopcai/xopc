import { gatewaySession } from '../service/gatewaySession';
import { appSettings } from '../service/settings';
import { XopcHomeAction, XopcHomeItem } from '../model/home';
import { XopcTask, XopcTaskList, XopcNote, XopcNoteList } from '../model/workspace';
import { XopcFile, XopcFiles } from '../model/files';
import { parseHome, recentClosed, homeCommand } from '../common/homeProtocol';
import { XopcDrawerProfile } from '../model/chat';

@ObservedV2
export class XopcProgressViewModel {
  @Trace needsUser: XopcHomeItem[] = [];
  @Trace background: XopcHomeItem[] = [];
  @Trace closed: XopcTask[] = [];
  @Trace loading: boolean = true;
  @Trace refreshing: boolean = false;
  @Trace homeError: string = '';
  @Trace tasksError: string = '';
  @Trace actionError: string = '';
  @Trace pending: boolean = false;
  private generation: number = 0;

  dispose(): void { this.generation++; }
  async refresh(): Promise<void> {
    if (this.refreshing) return;
    const generation = ++this.generation;
    this.refreshing = true;
    await Promise.all([this.loadHome(generation), this.loadTasks(generation)]);
    if (generation === this.generation) { this.loading = false; this.refreshing = false; }
  }
  private async loadHome(generation: number): Promise<void> {
    try {
      const home = parseHome(await gatewaySession.request('/api/home?locale=' + encodeURIComponent(appSettings.effectiveLanguage())));
      if (generation !== this.generation) return;
      this.needsUser = home.needsUser; this.background = home.background; this.homeError = '';
    } catch (error) { if (generation === this.generation) this.homeError = (error as Error).message; }
  }
  private async loadTasks(generation: number): Promise<void> {
    try {
      const result = JSON.parse(await gatewaySession.request('/api/tasks')) as XopcTaskList;
      if (!Array.isArray(result.items)) throw new Error('INVALID_TASK_LIST');
      if (generation !== this.generation) return;
      this.closed = recentClosed(result.items); this.tasksError = '';
    } catch (error) { if (generation === this.generation) this.tasksError = (error as Error).message; }
  }
  async act(action: XopcHomeAction): Promise<void> {
    if (this.pending) return;
    this.pending = true; this.actionError = '';
    try {
      const body = homeCommand(action);
      const path = action.type === 'connector_decision' ? '/api/home/decisions/respond'
        : action.type === 'retry_run' ? '/api/home/attention/retry' : '/api/home/attention/acknowledge';
      await gatewaySession.request(path, 'POST', JSON.stringify(body));
      await this.refresh();
    } catch (error) { this.actionError = (error as Error).message; }
    finally { this.pending = false; }
  }
}

@ObservedV2
export class XopcLibraryViewModel {
  @Trace files: XopcFile[] = [];
  @Trace notes: XopcNote[] = [];
  @Trace loading: boolean = true;
  @Trace refreshing: boolean = false;
  @Trace filesError: string = '';
  @Trace notesError: string = '';
  private generation: number = 0;

  dispose(): void { this.generation++; }
  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true; const generation = ++this.generation;
    await Promise.all([this.loadFiles(generation), this.loadNotes(generation)]);
    if (generation === this.generation) { this.loading = false; this.refreshing = false; }
  }
  private async loadFiles(generation: number): Promise<void> {
    try {
      const result = JSON.parse(await gatewaySession.request('/api/files/recent?limit=8')) as XopcFiles;
      if (!Array.isArray(result.items)) throw new Error('INVALID_FILE_LIST');
      if (generation !== this.generation) return;
      this.files = result.items.slice(0, 3); this.filesError = '';
    } catch (error) { if (generation === this.generation) this.filesError = (error as Error).message; }
  }
  private async loadNotes(generation: number): Promise<void> {
    try {
      const result = JSON.parse(await gatewaySession.request('/api/notes?limit=6&sortBy=updatedAt&sortOrder=desc')) as XopcNoteList;
      if (!Array.isArray(result.items)) throw new Error('INVALID_NOTE_LIST');
      if (generation !== this.generation) return;
      this.notes = result.items; this.notesError = '';
    } catch (error) { if (generation === this.generation) this.notesError = (error as Error).message; }
  }
}

@ObservedV2
export class XopcPersonalViewModel {
  @Trace name: string = '';
  @Trace role: string = '';
  @Trace loading: boolean = true;
  @Trace error: string = '';
  private generation: number = 0;

  dispose(): void { this.generation++; }
  async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.loading = true;
    try {
      const result = JSON.parse(await gatewaySession.request('/api/user-model')) as XopcDrawerProfile;
      if (generation !== this.generation) return;
      this.name = result.profile?.callName?.trim() || result.suggestedCallName?.trim() || '';
      this.role = result.profile?.role?.trim() || '';
      this.error = '';
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
}
