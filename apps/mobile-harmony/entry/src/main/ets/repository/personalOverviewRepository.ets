import { XopcClarification } from '../model/clarification';
import { XopcPersonalDeliveriesPage, XopcPersonalWorkPage } from '../model/personalOverview';
import { XopcPayload } from '../model/realtime';
import { XopcAutomation } from '../model/workspace';
import { gatewaySession } from '../service/gatewaySession';

const WORK_PAGE_SIZE: number = 10;

interface XopcPersonalClarificationSnapshot { clarification?: XopcClarification; }

export class XopcPersonalOverviewRepository {
  private async read<T>(path: string): Promise<T> {
    const response = JSON.parse(await gatewaySession.request(path)) as XopcPayload<T>;
    if (!response.payload) throw new Error('INVALID_PERSONAL_OVERVIEW');
    return response.payload;
  }

  async work(offset: number): Promise<XopcPersonalWorkPage> {
    const page = await this.read<XopcPersonalWorkPage>(
      '/api/personal-agent/activity?view=work&limit=' + WORK_PAGE_SIZE + '&offset=' + offset);
    if (!Array.isArray(page.current) || !Array.isArray(page.items) || typeof page.total !== 'number') {
      throw new Error('INVALID_PERSONAL_WORK');
    }
    return page;
  }

  async deliveries(offset: number): Promise<XopcPersonalDeliveriesPage> {
    const page = await this.read<XopcPersonalDeliveriesPage>('/api/personal-agent/activity?view=deliverables&limit=15&offset=' + offset);
    if (!Array.isArray(page.items) || (page.nextOffset !== null && !(page.nextOffset > offset))) {
      throw new Error('INVALID_PERSONAL_DELIVERIES');
    }
    return page;
  }

  async schedules(): Promise<XopcAutomation[]> {
    const items = await this.read<XopcAutomation[]>('/api/personal-agent/schedules');
    if (!Array.isArray(items)) throw new Error('INVALID_PERSONAL_SCHEDULES');
    return items.slice().sort((a: XopcAutomation, b: XopcAutomation): number => {
      const next = (a.state?.nextRunAtMs ?? Number.MAX_SAFE_INTEGER) - (b.state?.nextRunAtMs ?? Number.MAX_SAFE_INTEGER);
      return next || (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0);
    });
  }

  async prompt(conversationId: string): Promise<XopcClarification | undefined> {
    const snapshot = await this.read<XopcPersonalClarificationSnapshot>(
      '/api/sessions/' + encodeURIComponent(conversationId) + '/clarification');
    return snapshot.clarification ?? undefined;
  }
}
