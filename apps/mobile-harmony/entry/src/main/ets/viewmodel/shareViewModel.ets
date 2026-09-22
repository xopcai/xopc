import { XopcShareItem } from '../model/share';
import { shareService, XopcShareService } from '../service/shareService';

@ObservedV2
export class XopcShareViewModel {
  @Trace items: XopcShareItem[] = [];
  @Trace loading: boolean = false;
  @Trace busyId: string = '';
  @Trace error: string = '';
  @Trace showInactive: boolean = false;
  private service: XopcShareService = shareService;
  private generation: number = 0;

  dispose(): void { this.generation++; }
  visibleItems(): XopcShareItem[] {
    return this.showInactive ? this.items : this.items.filter((item: XopcShareItem): boolean => !item.revoked && !item.expired);
  }
  async load(): Promise<void> {
    if (this.loading) return;
    const generation = ++this.generation; this.loading = true; this.error = '';
    try {
      const items = await this.service.list();
      if (generation === this.generation) this.items = items;
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
  async revoke(item: XopcShareItem): Promise<boolean> {
    if (this.busyId || item.revoked) return false;
    this.busyId = item.id; this.error = '';
    try { await this.service.revoke(item.id); await this.loadAfterMutation(); return true; }
    catch (error) { this.error = (error as Error).message; return false; }
    finally { this.busyId = ''; }
  }
  async extend(item: XopcShareItem, ttlMs: number): Promise<boolean> {
    if (this.busyId || item.revoked) return false;
    this.busyId = item.id; this.error = '';
    try { await this.service.extend(item.id, ttlMs); await this.loadAfterMutation(); return true; }
    catch (error) { this.error = (error as Error).message; return false; }
    finally { this.busyId = ''; }
  }
  private async loadAfterMutation(): Promise<void> {
    const items = await this.service.list(); this.items = items;
  }
}
