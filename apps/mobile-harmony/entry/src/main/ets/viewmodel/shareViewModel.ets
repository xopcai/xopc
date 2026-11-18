import { XopcShareItem } from '../model/share';
import { shareService, XopcShareService } from '../service/shareService';

@ObservedV2
export class XopcShareViewModel {
  @Trace items: XopcShareItem[] = [];
  @Trace loading: boolean = false;
  @Trace busyId: string = '';
  @Trace error: string = '';
  @Trace activeOnly: boolean = false;
  @Trace loaded: boolean = false;
  private service: XopcShareService = shareService;
  private generation: number = 0;

  dispose(): void { this.generation++; this.loading = false; this.busyId = ''; }
  visibleItems(): XopcShareItem[] {
    return this.activeOnly ? this.items.filter((item: XopcShareItem): boolean => !item.revoked && !item.expired) : this.items;
  }
  async load(): Promise<void> {
    if (this.loading || this.busyId) return;
    const generation = ++this.generation; this.loading = true; this.error = '';
    try {
      const items = await this.service.list();
      if (generation === this.generation) { this.items = items; this.loaded = true; }
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
  async revoke(item: XopcShareItem): Promise<boolean> {
    return this.mutate(item, () => this.service.revoke(item.id));
  }
  async extend(item: XopcShareItem, ttlMs: number): Promise<boolean> {
    return this.mutate(item, () => this.service.extend(item.id, ttlMs));
  }
  private async mutate(item: XopcShareItem, action: () => Promise<void>): Promise<boolean> {
    if (this.busyId || this.loading || item.revoked || item.expired) return false;
    const generation = ++this.generation;
    this.busyId = item.id; this.error = '';
    try {
      await action();
      if (generation !== this.generation) return false;
      const items = await this.service.list();
      if (generation === this.generation) this.items = items;
      return true;
    } catch (error) {
      if (generation === this.generation) this.error = (error as Error).message;
      return false;
    } finally { if (generation === this.generation) this.busyId = ''; }
  }
}
