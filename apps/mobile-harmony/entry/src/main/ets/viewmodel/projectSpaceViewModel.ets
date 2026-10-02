import { XopcProject, XopcWorkspaceItem } from '../model/workspace';
import { XopcNoteIndexEntry } from '../model/note';
import { XopcProjectSpaceRepository } from '../repository/projectSpaceRepository';

@ObservedV2
export class XopcProjectSpaceViewModel {
  @Trace project?: XopcProject;
  @Trace tasks: XopcWorkspaceItem[] = [];
  @Trace notes: XopcNoteIndexEntry[] = [];
  @Trace automations: XopcWorkspaceItem[] = [];
  @Trace tasksTotal: number = 0;
  @Trace notesTotal: number = 0;
  @Trace loadingTasksMore: boolean = false;
  @Trace loadingNotesMore: boolean = false;
  @Trace loading: boolean = false;
  @Trace error: string = '';
  @Trace tasksError: boolean = false;
  @Trace notesError: boolean = false;
  @Trace automationsError: boolean = false;
  private repository: XopcProjectSpaceRepository = new XopcProjectSpaceRepository();
  private generation: number = 0;
  private loadedProjectId: string = '';

  dispose(): void { this.generation++; }

  async load(id: string): Promise<void> {
    const generation = ++this.generation;
    if (this.loadedProjectId !== id) this.project = undefined;
    this.loadedProjectId = id;
    this.loading = true; this.error = '';
    this.tasks = []; this.notes = []; this.automations = []; this.tasksTotal = 0; this.notesTotal = 0;
    this.loadingTasksMore = false; this.loadingNotesMore = false;
    this.tasksError = false; this.notesError = false; this.automationsError = false;
    try {
      const project = await this.repository.project(id);
      if (generation !== this.generation) return;
      this.project = project;
      await Promise.all([this.loadTasks(id, generation), this.loadNotes(id, generation), this.loadAutomations(id, generation)]);
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }

  private async loadTasks(id: string, generation: number): Promise<void> {
    try {
      const page = await this.repository.tasks(id);
      if (generation === this.generation) { this.tasks = page.items; this.tasksTotal = page.total; }
    }
    catch (_) { if (generation === this.generation) this.tasksError = true; }
  }

  private async loadNotes(id: string, generation: number): Promise<void> {
    try {
      const page = await this.repository.notes(id);
      if (generation === this.generation) { this.notes = page.items; this.notesTotal = page.total; }
    }
    catch (_) { if (generation === this.generation) this.notesError = true; }
  }

  private async loadAutomations(id: string, generation: number): Promise<void> {
    try { const items = await this.repository.automations(id); if (generation === this.generation) this.automations = items; }
    catch (_) { if (generation === this.generation) this.automationsError = true; }
  }

  async moreTasks(id: string): Promise<void> {
    if (this.loadingTasksMore || this.tasks.length >= this.tasksTotal) return;
    const generation = this.generation; this.loadingTasksMore = true;
    try {
      const page = await this.repository.tasks(id, this.tasks.length);
      if (generation === this.generation) { this.tasks = this.tasks.concat(page.items); this.tasksTotal = page.total; }
    } catch (_) { if (generation === this.generation) this.tasksError = true; }
    finally { if (generation === this.generation) this.loadingTasksMore = false; }
  }

  async moreNotes(id: string): Promise<void> {
    if (this.loadingNotesMore || this.notes.length >= this.notesTotal) return;
    const generation = this.generation; this.loadingNotesMore = true;
    try {
      const page = await this.repository.notes(id, this.notes.length);
      if (generation === this.generation) { this.notes = this.notes.concat(page.items); this.notesTotal = page.total; }
    } catch (_) { if (generation === this.generation) this.notesError = true; }
    finally { if (generation === this.generation) this.loadingNotesMore = false; }
  }
}
