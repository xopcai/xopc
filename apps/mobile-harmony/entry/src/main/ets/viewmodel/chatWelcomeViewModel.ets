import { XopcChatAgent, XopcContextSummary } from '../model/chat';
import { XopcWelcomeContext, XopcWelcomeData, XopcWelcomeModel, XopcWelcomeAgent, buildChatWelcome, welcomeAgentName } from '../common/chatWelcome';
import { gatewaySession } from '../service/gatewaySession';

interface XopcWelcomeTask { task: XopcWelcomeTaskFields; operationalState?: string; attention?: XopcWelcomeAttention[]; receipts?: XopcWelcomeReceipt[]; }
interface XopcWelcomeTaskFields { title: string; phase?: string; }
interface XopcWelcomeAttention { summary?: string; }
interface XopcWelcomeReceipt { nextAction?: string; summary?: string; status?: string; failure?: XopcWelcomeFailure; verification?: XopcWelcomeVerification; }
interface XopcWelcomeFailure { recoveryAction?: string; }
interface XopcWelcomeVerification { status?: string; }
interface XopcWelcomeProject { project: XopcWelcomeProjectFields; }
interface XopcWelcomeProjectFields { name: string; }
interface XopcWelcomeOperating { view?: XopcWelcomeOperatingView; }
interface XopcWelcomeOperatingView { digest?: XopcWelcomeDigest; blockers?: XopcWelcomeBlocker[]; recentResults?: XopcWelcomeResult[]; }
interface XopcWelcomeDigest { health?: string; recommendedAction?: string; }
interface XopcWelcomeBlocker { detail?: string; title?: string; }
interface XopcWelcomeResult { receipt: XopcWelcomeReceipt; }

@ObservedV2
export class XopcChatWelcomeViewModel {
  @Trace model?: XopcWelcomeModel;
  @Trace loading: boolean = false;
  @Trace degraded: boolean = false;
  private generation: number = 0;
  dispose(): void { this.generation++; }

  async load(data: XopcWelcomeData, summary?: XopcContextSummary, workspace: string = '', selectedAgent?: XopcChatAgent, agentId: string = 'main'): Promise<void> {
    const generation = ++this.generation; this.loading = true; this.degraded = false;
    const agent: XopcWelcomeAgent = { id: selectedAgent?.id || agentId || 'main', name: selectedAgent?.name,
      description: selectedAgent?.description, skills: selectedAgent?.effective?.skills?.mode === 'selected' ? selectedAgent.effective.skills.include ?? [] : [] };
    if (selectedAgent) agent.name = welcomeAgentName(agent, data);
    const task = summary?.work.task; const project = summary?.work.project;
    const context: XopcWelcomeContext = task ? { kind: 'task', taskTitle: task.title, phase: task.phase }
      : project ? { kind: 'generalProject', projectName: project.title }
        : workspace.trim() ? { kind: 'workingDirectory', path: workspace.trim() } : { kind: 'empty' };
    this.model = buildChatWelcome(context, data.copy, agent, new Date().toISOString().slice(0, 10));
    try {
      if (task) {
        const detail = JSON.parse(await gatewaySession.request('/api/tasks/' + encodeURIComponent(task.id))) as XopcWelcomeTask;
        if (!detail.task || typeof detail.task.title !== 'string') throw new Error('INVALID_TASK');
        context.taskTitle = detail.task.title; context.phase = detail.task.phase; context.operationalState = detail.operationalState;
        context.attentionSummary = detail.attention?.[0]?.summary; context.nextAction = detail.receipts?.[0]?.nextAction;
        context.recentFailure = detail.receipts?.[0]?.failure?.recoveryAction;
      } else if (project) {
        const detail = JSON.parse(await gatewaySession.request('/api/projects/' + encodeURIComponent(project.id))) as XopcWelcomeProject;
        if (!detail.project || typeof detail.project.name !== 'string') throw new Error('INVALID_PROJECT');
        context.projectName = detail.project.name;
        const response = JSON.parse(await gatewaySession.request('/api/projects/' + encodeURIComponent(project.id) + '/operating-view')) as XopcWelcomeOperating;
        const view = response.view; if (!view?.digest) throw new Error('INVALID_PROJECT_OPERATING_VIEW');
        context.recommendedAction = view.digest.recommendedAction;
        context.blockedReason = view.blockers?.[0]?.detail ?? view.blockers?.[0]?.title;
        const failure = view.digest.health === 'attention' ? view.recentResults?.find((entry: XopcWelcomeResult): boolean => entry.receipt.status === 'failed' || entry.receipt.verification?.status === 'failed') : undefined;
        context.recentFailure = failure?.receipt.failure?.recoveryAction ?? failure?.receipt.summary;
      }
    } catch (_) { if (generation === this.generation) this.degraded = true; }
    if (generation !== this.generation) return;
    this.model = buildChatWelcome(context, data.copy, agent, new Date().toISOString().slice(0, 10)); this.loading = false;
  }
}
