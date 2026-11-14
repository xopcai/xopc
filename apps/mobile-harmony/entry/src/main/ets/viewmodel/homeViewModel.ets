import { gatewaySession } from '../service/gatewaySession';
import { appSettings } from '../service/settings';
import { XopcHomeAction, XopcHomeDelivery, XopcHomeItem } from '../model/home';
import { XopcWorkspaceRepository } from '../repository/workspaceRepository';
import { XopcAutomationMetrics } from '../model/workspace';
import { mobileRoute, parseHome, homeCommand } from '../common/homeProtocol';
import { XopcUnderstandingSummary, XopcUserGoal } from '../model/userUnderstanding';

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
  @Trace deliveries: XopcHomeDelivery[] = [];
  @Trace automationMetrics?: XopcAutomationMetrics;
  @Trace loading: boolean = true;
  @Trace homeError: string = '';
  @Trace actionError: string = '';
  @Computed get pendingCount(): number { return this.loading || this.homeError ? 0 : this.needsUser.length; }
  @Trace pending: boolean = false;
  private generation: number = 0;
  private workspace: XopcWorkspaceRepository = new XopcWorkspaceRepository();
  private homeRequest?: Promise<void>;

  dispose(): void {
    this.generation++;
    this.homeRequest = undefined;
  }

  async refresh(): Promise<void> {
    if (this.homeRequest) return this.homeRequest;
    const generation = ++this.generation;
    const request = this.loadHome(generation);
    this.homeRequest = request;
    void this.loadAutomationMetrics(generation);
    await request;
    if (generation === this.generation) {
      this.homeRequest = undefined;
      this.loading = false;
    }
  }
  private async loadHome(generation: number): Promise<void> {
    try {
      const home = parseHome(await gatewaySession.request('/api/home?locale=' + encodeURIComponent(appSettings.effectiveLanguage()) + '&attention=all'));
      if (generation !== this.generation) return;
      this.needsUser = home.needsUser; this.background = home.background;
      this.deliveries = Array.isArray(home.recentDeliveries) ? home.recentDeliveries.filter((item: XopcHomeDelivery): boolean =>
        !!item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.summary === 'string'
          && typeof item.href === 'string' && !!mobileRoute(item.href)) : [];
      this.homeError = '';
    } catch (error) { if (generation === this.generation) this.homeError = (error as Error).message; }
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
      if (action.type === 'retry_task') {
        await this.workspace.retryTask(action.taskId ?? '');
      } else {
        const body = homeCommand(action);
        const path = action.type === 'connector_decision' ? '/api/home/decisions/respond'
          : action.type === 'retry_run' ? '/api/home/attention/retry' : '/api/home/attention/acknowledge';
        await gatewaySession.request(path, 'POST', JSON.stringify(body));
      }
      await this.homeRequest;
      await this.refresh();
    } catch (error) { this.actionError = (error as Error).message; }
    finally { this.pending = false; }
  }
}

@ObservedV2
export class XopcPersonalViewModel {
  @Trace goals: XopcUserGoal[] = [];
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
      this.goals = result.goals ?? [];
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
