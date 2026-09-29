import { gatewaySession } from '../service/gatewaySession';
import { appSettings } from '../service/settings';
import { XopcHomeAction, XopcHomeItem } from '../model/home';
import { XopcTask, XopcTaskList, XopcAutomationMetrics } from '../model/workspace';
import { parseHome, recentClosed, homeCommand } from '../common/homeProtocol';
import { XopcUnderstandingItem, XopcUnderstandingRule, XopcUnderstandingSummary, XopcUserGoal } from '../model/userUnderstanding';

interface XopcGoalPatchRequest {
  title: string;
  desiredOutcome: string;
  status: string;
  targetAt?: number | null;
}

interface XopcGoalCreateScope { type: string; }
interface XopcGoalCreateRequest {
  title: string;
  desiredOutcome: string;
  scope: XopcGoalCreateScope;
  targetAt?: number;
}

@ObservedV2
export class XopcProgressViewModel {
  @Trace needsUser: XopcHomeItem[] = [];
  @Trace background: XopcHomeItem[] = [];
  @Trace closed: XopcTask[] = [];
  @Trace automationMetrics?: XopcAutomationMetrics;
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
    const primary = Promise.all([this.loadHome(generation), this.loadTasks(generation)]);
    void this.loadAutomationMetrics(generation);
    await primary;
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
  private async loadAutomationMetrics(generation: number): Promise<void> {
    try {
      const result = JSON.parse(await gatewaySession.request('/api/automations/metrics')) as XopcAutomationMetrics;
      if (typeof result.totalAutomations !== 'number' || typeof result.enabledAutomations !== 'number') {
        throw new Error('INVALID_AUTOMATION_METRICS');
      }
      if (generation === this.generation) this.automationMetrics = result;
    } catch (_error) {
      if (generation === this.generation) this.automationMetrics = undefined;
    }
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
export class XopcPersonalViewModel {
  @Trace name: string = '';
  @Trace role: string = '';
  @Trace understandingCount: number = 0;
  @Trace explicitCount: number = 0;
  @Trace learnedCount: number = 0;
  @Trace reviewCount: number = 0;
  @Trace workMemoryCount: number = 0;
  @Trace focusTitle: string = '';
  @Trace focusOutcome: string = '';
  @Trace goals: XopcUserGoal[] = [];
  @Trace recent: XopcUnderstandingItem[] = [];
  @Trace rules: XopcUnderstandingRule[] = [];
  @Trace loading: boolean = true;
  @Trace error: string = '';
  @Trace savingGoal: boolean = false;
  private generation: number = 0;

  dispose(): void { this.generation++; }
  async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.loading = true;
    try {
      const result = JSON.parse(await gatewaySession.request('/api/user-model/mobile-summary')) as XopcUnderstandingSummary;
      if (generation !== this.generation) return;
      this.name = result.profile.callName.trim() || result.suggestedCallName.trim() || '';
      this.role = result.profile.role.trim() || '';
      this.understandingCount = result.counts.total;
      this.explicitCount = result.counts.explicit;
      this.learnedCount = result.counts.learned;
      this.reviewCount = result.counts.review;
      this.workMemoryCount = result.counts.workMemory;
      this.focusTitle = result.primaryFocus?.title ?? '';
      this.focusOutcome = result.primaryFocus?.desiredOutcome ?? '';
      this.goals = (result.goals ?? []).slice(0, 5);
      this.recent = result.recent.slice(0, 3);
      this.rules = result.rules.slice(0, 3);
      this.error = '';
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }

  async saveGoal(id: string, title: string, desiredOutcome: string, status: string, targetAt?: number): Promise<boolean> {
    if (this.savingGoal) return false;
    this.savingGoal = true;
    try {
      if (id) {
        const body: XopcGoalPatchRequest = {
          title: title,
          desiredOutcome: desiredOutcome,
          status: status,
          targetAt: targetAt ?? null
        };
        await gatewaySession.request('/api/user-model/goals/' + encodeURIComponent(id), 'PATCH', JSON.stringify(body));
      } else {
        const body: XopcGoalCreateRequest = {
          title: title,
          desiredOutcome: desiredOutcome,
          scope: { type: 'global' }
        };
        if (targetAt !== undefined) body.targetAt = targetAt;
        await gatewaySession.request('/api/user-model/goals', 'POST', JSON.stringify(body));
      }
      await this.refresh();
      return true;
    } catch (error) {
      this.error = (error as Error).message;
      return false;
    } finally {
      this.savingGoal = false;
    }
  }
}
