import { XopcContextSummary } from '../model/chat';
import { XopcWelcomeContext, XopcWelcomeData, XopcWelcomeModel, buildChatWelcome } from '../common/chatWelcome';
import { gatewaySession } from '../service/gatewaySession';

interface XopcWelcomeTask {
  task: XopcWelcomeTaskFields;
  operationalState?: string;
  attention?: XopcWelcomeAttention[];
  receipts?: XopcWelcomeReceipt[];
}
interface XopcWelcomeTaskFields { title: string; phase?: string; }
interface XopcWelcomeAttention { summary?: string; }
interface XopcWelcomeReceipt {
  nextAction?: string;
  summary?: string;
  status?: string;
  failure?: XopcWelcomeFailure;
  verification?: XopcWelcomeVerification;
}
interface XopcWelcomeFailure { recoveryAction?: string; }
interface XopcWelcomeVerification { status?: string; }
interface XopcWelcomeProject { project: XopcWelcomeProjectFields; }
interface XopcWelcomeProjectFields { name: string; }
interface XopcWelcomeOperating { view?: XopcWelcomeOperatingView; }
interface XopcWelcomeOperatingView {
  digest?: XopcWelcomeDigest;
  blockers?: XopcWelcomeBlocker[];
  recentResults?: XopcWelcomeResult[];
}
interface XopcWelcomeDigest { health?: string; recommendedAction?: string; }
interface XopcWelcomeBlocker { detail?: string; title?: string; }
interface XopcWelcomeResult { receipt: XopcWelcomeReceipt; }

@ObservedV2
export class XopcChatWelcomeViewModel {
  @Trace model?: XopcWelcomeModel;
  private generation: number = 0;

  clear(): void {
    this.generation++;
    this.model = undefined;
  }

  async load(data: XopcWelcomeData, summary?: XopcContextSummary): Promise<void> {
    const generation = ++this.generation;
    const task = summary?.work.task;
    const project = summary?.work.project;
    const context: XopcWelcomeContext = task
      ? { kind: 'task', taskTitle: task.title, phase: task.phase }
      : project
        ? { kind: 'project', projectName: project.title }
        : { kind: 'empty' };
    this.model = buildChatWelcome(context, data.copy);
    if (!task && !project) return;

    try {
      if (task) {
        const detail = JSON.parse(await gatewaySession.request('/api/tasks/' +
          encodeURIComponent(task.id))) as XopcWelcomeTask;
        if (!detail.task || typeof detail.task.title !== 'string') throw new Error('INVALID_TASK');
        const receipt = detail.receipts?.[0];
        context.taskTitle = detail.task.title;
        context.phase = detail.task.phase;
        context.operationalState = detail.operationalState;
        context.attentionSummary = detail.attention?.[0]?.summary;
        context.nextAction = receipt?.nextAction;
        context.recentFailure = receipt?.failure?.recoveryAction;
      } else if (project) {
        const detail = JSON.parse(await gatewaySession.request('/api/projects/' +
          encodeURIComponent(project.id))) as XopcWelcomeProject;
        if (!detail.project || typeof detail.project.name !== 'string') throw new Error('INVALID_PROJECT');
        context.projectName = detail.project.name;
        const response = JSON.parse(await gatewaySession.request('/api/projects/' +
          encodeURIComponent(project.id) + '/operating-view')) as XopcWelcomeOperating;
        const view = response.view;
        if (!view?.digest) throw new Error('INVALID_PROJECT_OPERATING_VIEW');
        context.recommendedAction = view.digest.recommendedAction;
        context.blockedReason = view.blockers?.[0]?.detail ?? view.blockers?.[0]?.title;
        const failure = view.digest.health === 'attention'
          ? view.recentResults?.find((entry: XopcWelcomeResult): boolean =>
            entry.receipt.status === 'failed' || entry.receipt.verification?.status === 'failed')
          : undefined;
        context.recentFailure = failure?.receipt.failure?.recoveryAction ?? failure?.receipt.summary;
      }
    } catch (_) {
      // The welcome surface stays quiet when context cannot be verified.
    }
    if (generation !== this.generation) return;
    this.model = buildChatWelcome(context, data.copy);
  }
}
