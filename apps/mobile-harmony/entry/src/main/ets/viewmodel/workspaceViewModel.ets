import { XopcSection, XopcWorkspaceItem, XopcAutomationRun } from '../model/workspace';
import { XopcWorkspaceRepository } from '../repository/workspaceRepository';

@ObservedV2
export class XopcWorkspaceViewModel {
  @Trace items: XopcWorkspaceItem[] = [];
  @Trace runs: XopcAutomationRun[] = [];
  @Trace selected?: XopcWorkspaceItem;
  @Trace editing: boolean = false;
  @Trace busy: boolean = false;
  @Trace error: string = '';
  @Trace hasMore: boolean = false;
  @Trace title: string = '';
  @Trace body: string = '';
  @Trace cron: string = '';
  @Trace projectId: string = '';
  private section: XopcSection = 'tasks';
  private repository: XopcWorkspaceRepository = new XopcWorkspaceRepository();
  private generation: number = 0;
  private mutationId: string = '';
  private mutationSignature: string = '';

  start(section: XopcSection, initialId: string = ''): void { this.section = section; if (initialId) this.open(initialId); else this.list(''); }
  dispose(): void { this.generation++; }
  async list(search: string, more: boolean = false): Promise<void> {
    if (this.busy) return;
    const generation = ++this.generation; this.busy = true; this.error = '';
    try {
      const page = await this.repository.list(this.section, search, more ? this.items.length : 0);
      if (generation !== this.generation) return;
      this.items = more ? this.items.concat(page.items.filter((item): boolean => !this.items.some((old): boolean => old.id === item.id))) : page.items;
      this.hasMore = page.hasMore;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  async open(id: string): Promise<void> {
    if (this.busy) return;
    const generation = ++this.generation; this.busy = true; this.error = '';
    try {
      const item = await this.repository.detail(this.section, id);
      const runs = this.section === 'automations' ? await this.repository.runs(id) : [];
      if (generation !== this.generation) return;
      this.selected = item; this.editing = false; this.runs = runs; this.copyFields(item);
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  private copyFields(item: XopcWorkspaceItem): void {
    this.title = item.title; this.body = item.body; this.cron = item.cron ?? ''; this.projectId = item.projectId ?? '';
    this.mutationId = ''; this.mutationSignature = '';
  }
  create(): void {
    if (this.busy) return;
    const item: XopcWorkspaceItem = { id: '', title: '', body: '', status: '', version: 0, editable: true, actions: [], cron: '0 9 * * *' };
    this.selected = item; this.editing = true; this.copyFields(item); this.error = ''; this.runs = [];
  }
  back(): void { if (!this.busy) { this.selected = undefined; this.editing = false; this.error = ''; this.list(''); } }
  private idempotency(signature: string): string {
    if (signature !== this.mutationSignature || !this.mutationId) {
      this.mutationSignature = signature; this.mutationId = this.repository.uuid();
    }
    return this.mutationId;
  }
  async save(): Promise<void> {
    const selected = this.selected;
    if (!selected || this.busy || (!this.title.trim() && this.section !== 'notes')) return;
    this.busy = true; this.error = '';
    const item: XopcWorkspaceItem = { id: selected.id, title: this.title, body: this.body, status: selected.status,
      version: selected.version, projectId: this.projectId.trim() || undefined, cron: this.cron,
      editable: selected.editable, actions: selected.actions, automation: selected.automation };
    try {
      await this.repository.save(this.section, item, this.idempotency(JSON.stringify(item)));
      this.busy = false;
      if (selected.id) await this.open(selected.id); else this.back();
    } catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
  }
  async action(action: string, agentId: string): Promise<void> {
    const selected = this.selected;
    if (!selected?.id || this.busy) return;
    this.busy = true; this.error = '';
    try {
      await this.repository.action(this.section, selected, action, agentId,
        this.idempotency(selected.id + ':' + selected.version + ':' + action + ':' + agentId));
      this.busy = false;
      if (action === 'delete') this.back(); else await this.open(selected.id);
    } catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
  }
}
