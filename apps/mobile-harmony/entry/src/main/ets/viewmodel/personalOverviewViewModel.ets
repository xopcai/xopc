import { XopcClarification } from '../model/clarification';
import { XopcPersonalDelivery, XopcPersonalWorkGroup, XopcPersonalWorkItem } from '../model/personalOverview';
import { XopcAutomation } from '../model/workspace';
import { XopcPersonalOverviewRepository } from '../repository/personalOverviewRepository';

function needsAttention(item: XopcPersonalWorkItem): boolean {
  return !!item.attention || item.presentation?.status === 'needsUser' || item.presentation?.status === 'review';
}

function ended(item: XopcPersonalWorkItem): boolean {
  return item.phase === 'closed' || item.operationalState === 'failed' || item.operationalState === 'cancelled';
}

@ObservedV2
export class XopcPersonalOverviewViewModel {
  @Trace private current: XopcPersonalWorkItem[] = [];
  @Trace private history: XopcPersonalWorkItem[] = [];
  @Trace private clarification?: XopcClarification;
  @Trace private historyTotal: number = 0;
  @Trace private historyOffset: number = 0;
  @Trace workLoading: boolean = false;
  @Trace workLoaded: boolean = false;
  @Trace workError: string = '';
  @Trace schedules: XopcAutomation[] = [];
  @Trace schedulesLoading: boolean = false;
  @Trace schedulesLoaded: boolean = false;
  @Trace scheduleError: string = '';
  @Trace deliveries: XopcPersonalDelivery[] = [];
  @Trace deliveryLoading: boolean = false;
  @Trace deliveryLoaded: boolean = false;
  @Trace deliveryError: string = '';
  @Trace nextDeliveryOffset: number | null = null;
  private generation: number = 0;
  private promptRevision: number = 0;
  private repository: XopcPersonalOverviewRepository = new XopcPersonalOverviewRepository();

  @Computed get attention(): XopcPersonalWorkItem[] { return this.current.filter(needsAttention); }
  @Computed get active(): XopcPersonalWorkItem[] {
    return this.current.filter((item: XopcPersonalWorkItem): boolean => !needsAttention(item) && !ended(item));
  }
  @Computed get prompt(): XopcClarification | undefined {
    const prompt = this.clarification;
    return prompt?.status === 'open' && (prompt.expiresAt === undefined || prompt.expiresAt > Date.now()) &&
      !this.attention.some((item: XopcPersonalWorkItem): boolean => item.prompt?.id === prompt.id) ? prompt : undefined;
  }
  @Computed get attentionCount(): number { return this.attention.length + (this.prompt ? 1 : 0); }
  @Computed get runningCount(): number {
    return this.active.filter((item: XopcPersonalWorkItem): boolean =>
      item.operationalState === 'running' || item.operationalState === 'verifying').length;
  }
  @Computed get moreWork(): boolean { return this.historyOffset > 0 && this.historyOffset < this.historyTotal; }
  @Computed get groups(): XopcPersonalWorkGroup[] {
    const currentIds = new Set<string>(this.current.map((item: XopcPersonalWorkItem): string => item.id));
    const items = this.current.filter((item: XopcPersonalWorkItem): boolean => ended(item) && !needsAttention(item))
      .concat(this.history.filter((item: XopcPersonalWorkItem): boolean => !currentIds.has(item.id)))
      .sort((a: XopcPersonalWorkItem, b: XopcPersonalWorkItem): number => b.updatedAt - a.updatedAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const week = new Date(today.getTime());
    week.setDate(week.getDate() - (week.getDay() + 6) % 7);
    const groups: XopcPersonalWorkGroup[] = [];
    for (const item of items) {
      const id = item.updatedAt >= today.getTime() ? 'today' : item.updatedAt >= week.getTime() ? 'week' : 'earlier';
      const group = groups.find((entry: XopcPersonalWorkGroup): boolean => entry.id === id);
      if (group) group.items.push(item); else groups.push({ id, items: [item] });
    }
    return groups;
  }

  dispose(): void { this.generation++; }

  async work(more: boolean = false): Promise<void> {
    if (this.workLoading || (more && !this.moreWork)) return;
    const generation = this.generation;
    const offset = more ? this.historyOffset : 0;
    this.workLoading = true;
    this.workError = '';
    try {
      const page = await this.repository.work(offset);
      if (generation !== this.generation) return;
      if (!more) this.current = page.current;
      const seen = new Set<string>(this.history.map((item: XopcPersonalWorkItem): string => item.id));
      this.history = more
        ? this.history.concat(page.items.filter((item: XopcPersonalWorkItem): boolean => !seen.has(item.id))) : page.items;
      this.historyTotal = page.items.length ? page.total : offset;
      this.historyOffset = offset + page.items.length;
      this.workLoaded = true;
    } catch (error) { if (generation === this.generation) this.workError = (error as Error).message; }
    finally { if (generation === this.generation) this.workLoading = false; }
  }

  async loadPrompt(id: string): Promise<void> {
    const generation = this.generation;
    const revision = ++this.promptRevision;
    try {
      const prompt = await this.repository.prompt(id);
      if (generation === this.generation && revision === this.promptRevision) this.clarification = prompt;
    } catch (_) { /* Task results remain useful when clarification is unavailable. */ }
  }

  async loadSchedules(): Promise<void> {
    if (this.schedulesLoading) return;
    const generation = this.generation;
    this.schedulesLoading = true;
    this.scheduleError = '';
    try {
      const items = await this.repository.schedules();
      if (generation === this.generation) { this.schedules = items; this.schedulesLoaded = true; }
    } catch (error) { if (generation === this.generation) this.scheduleError = (error as Error).message; }
    finally { if (generation === this.generation) this.schedulesLoading = false; }
  }

  async loadDeliveries(more: boolean = false): Promise<void> {
    if (this.deliveryLoading || (more && this.nextDeliveryOffset === null)) return;
    const generation = this.generation;
    this.deliveryLoading = true;
    this.deliveryError = '';
    try {
      const page = await this.repository.deliveries(more ? this.nextDeliveryOffset ?? 0 : 0);
      if (generation !== this.generation) return;
      const seen = new Set<string>(this.deliveries.map((item: XopcPersonalDelivery): string => item.id));
      this.deliveries = more
        ? this.deliveries.concat(page.items.filter((item: XopcPersonalDelivery): boolean => !seen.has(item.id))) : page.items;
      this.nextDeliveryOffset = page.nextOffset;
      this.deliveryLoaded = true;
    } catch (error) { if (generation === this.generation) this.deliveryError = (error as Error).message; }
    finally { if (generation === this.generation) this.deliveryLoading = false; }
  }
}
