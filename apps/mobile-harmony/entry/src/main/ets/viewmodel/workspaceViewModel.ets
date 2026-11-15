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
  @Trace loadedSearch: string = '';
  @Trace title: string = '';
  @Trace body: string = '';
  @Trace cron: string = '';
  @Trace automationTimeZone: string = '';
  @Trace projectId: string = '';
  @Trace priority: string = 'normal';
  @Trace dueAt?: number;
  @Trace openingId: string = '';
  private section: XopcSection = 'tasks';
  private repository: XopcWorkspaceRepository = new XopcWorkspaceRepository();
  private generation: number = 0;
  private listing: boolean = false;
  private mutationId: string = '';
  private mutationSignature: string = '';

  start(section: XopcSection, initialId: string = '', createOnAppear: boolean = false, projectId: string = ''): void {
    this.section = section;
    if (createOnAppear) this.create(projectId);
    else if (initialId) this.open(initialId);
    else {
      const cached = this.repository.cachedList(section);
      if (cached) this.items = cached.items;
      void this.list('');
    }
  }
  dispose(): void { this.generation++; }
  async list(search: string, more: boolean = false): Promise<void> {
    if (this.busy) return;
    this.listing = true;
    const generation = ++this.generation; this.busy = true; this.error = '';
    try {
      const page = await this.repository.list(this.section, search, more ? this.items.length : 0);
      if (generation !== this.generation) return;
      this.items = more ? this.items.concat(page.items.filter((item): boolean => !this.items.some((old): boolean => old.id === item.id))) : page.items;
      this.hasMore = page.hasMore;
      this.loadedSearch = search.trim();
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) { this.listing = false; this.busy = false; } }
  }
  async open(id: string): Promise<void> {
    if (this.busy && !this.listing) return;
    this.listing = false;
    const generation = ++this.generation; this.busy = true; this.error = ''; this.openingId = id;
    this.selected = undefined; this.editing = false; this.runs = [];
    try {
      const item = await this.repository.detail(this.section, id);
      const runs = this.section === 'automations' ? await this.repository.runs(id) : [];
      if (generation !== this.generation) return;
      this.selected = item; this.editing = false; this.runs = runs; this.copyFields(item);
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) { this.busy = false; this.openingId = ''; } }
  }
  cancelOpening(): void {
    if (!this.openingId) return;
    this.generation++; this.openingId = ''; this.busy = false; this.error = '';
  }
  private copyFields(item: XopcWorkspaceItem): void {
    this.title = item.title; this.body = item.body; this.cron = item.cron ?? ''; this.projectId = item.projectId ?? '';
    this.priority = item.priority || 'normal'; this.dueAt = item.dueAt;
    this.automationTimeZone = item.automationTimeZone ?? '';
    this.mutationId = ''; this.mutationSignature = '';
  }
  create(projectId: string = ''): void {
    if (this.busy || this.section === 'automations') return;
    const item: XopcWorkspaceItem = { id: '', title: '', body: '', status: '', version: 0, editable: true, actions: [] };
    this.selected = item; this.editing = true; this.copyFields(item); this.projectId = projectId; this.error = ''; this.runs = [];
  }
  back(): void { if (!this.busy) { this.selected = undefined; this.editing = false; this.openingId = ''; this.error = ''; this.list(''); } }
  cancelEdit(): void {
    if (!this.selected || this.busy) return;
    this.copyFields(this.selected); this.editing = false; this.error = '';
  }
  async refreshDetail(): Promise<void> {
    const selected = this.selected;
    if (!selected?.id || this.busy || this.editing) return;
    const generation = this.generation; this.busy = true; this.error = '';
    try {
      const item = await this.repository.detail(this.section, selected.id);
      const runs = this.section === 'automations' ? await this.repository.runs(selected.id) : [];
      if (generation !== this.generation) return;
      this.selected = item; this.runs = runs; this.copyFields(item);
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  private idempotency(signature: string): string {
    if (signature !== this.mutationSignature || !this.mutationId) {
      this.mutationSignature = signature; this.mutationId = this.repository.uuid();
    }
    return this.mutationId;
  }
  async save(): Promise<string> {
    const selected = this.selected;
    if (!selected || this.busy || !this.title.trim()) return '';
    this.busy = true; this.error = '';
    const item: XopcWorkspaceItem = { id: selected.id, title: this.title, body: this.body, status: selected.status,
      version: selected.version, projectId: this.projectId.trim() || undefined, priority: this.priority, dueAt: this.dueAt, cron: this.cron,
      editable: selected.editable, actions: selected.actions, automation: selected.automation, automationTimeZone: this.automationTimeZone };
    try {
      const id = await this.repository.save(this.section, item, this.idempotency(JSON.stringify(item)));
      this.busy = false;
      if (selected.id) { this.editing = false; await this.refreshDetail(); }
      return id;
    } catch (error) { this.error = (error as Error).message; return ''; }
    finally { this.busy = false; }
  }
  async startAutomation(): Promise<string> {
    const id = this.selected?.id;
    if (!id || this.busy) return '';
    const generation = this.generation;
    this.busy = true; this.error = '';
    try {
      const runId = await this.repository.startAutomation(id, this.idempotency(id + ':run'));
      this.mutationId = ''; this.mutationSignature = '';
      return generation === this.generation ? runId : '';
    } catch (error) {
      if (generation === this.generation) this.error = (error as Error).message;
      return '';
    } finally { if (generation === this.generation) this.busy = false; }
  }

  async action(action: string, agentId: string): Promise<void> {
    const selected = this.selected;
    if (!selected?.id || this.busy) return;
    this.busy = true; this.error = '';
    try {
      await this.repository.action(this.section, selected, action, agentId,
        this.idempotency(selected.id + ':' + selected.version + ':' + action + ':' + agentId));
      this.busy = false;
      if (action === 'delete') this.back(); else await this.refreshDetail();
    } catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
  }
}
