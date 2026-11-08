import { MessageBus } from '../../infra/bus/index.js';
import type { Config } from '../../config/schema.js';
import { resolveEffectiveAgentProfile, resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import { resolveModel } from '../../providers/index.js';
import { getSessionInteractionPolicy } from '../session/interaction-policy.js';
import { monitorChildRun, getChildRun, getChildRunMessages } from './child-run-monitor.js';

/** Reconstruct tools from current configuration, intersected with the original delegation grant. */
export async function resumeChildRun(parentConversationId: string, id: string, text: string, config: Config): Promise<void> {
  const view = getChildRun(parentConversationId, id);
  if (view.status === 'running') throw new Error('Child is already running; use steer.');
  if (!view.workspace || !view.modelRef || !view.allowedTools || !text.trim() || text.length > 32000) throw new Error('Child has no resumable context or invalid input.');
  const policy = getSessionInteractionPolicy(parentConversationId);
  if (policy.mode === 'plan' || policy.access === 'read-only') throw new Error('Switch out of Plan and read-only modes before resuming delegated work.');
  const [{ createDelegateChildHandle }, { AgentToolsFactory }, { InMemoryTranscriptRuntime }, { protectDelegatedTool }] = await Promise.all([
    import('../child-agent-factory.js'), import('../tools/factory.js'), import('../embedded/transcript-runtime.js'), import('../tools/delegation-policy.js'),
  ]);
  if (getChildRun(parentConversationId, id).status === 'running') throw new Error('Child is already running.');
  const model = resolveModel(view.modelRef);
  const bus = new MessageBus();
  const profile = view.agentId ? resolveEffectiveAgentProfile(view.agentId) : resolveEffectiveAgentProfileForSession(parentConversationId);
  const runtime = new InMemoryTranscriptRuntime({ runtimeId: id, cwd: view.workspace, initialMessages: getChildRunMessages(parentConversationId, id) });
  const child = createDelegateChildHandle({ workspace: view.workspace, goal: text, context: view.task,
    requesterConversationId: parentConversationId, conversationId: id, transcriptRuntime: runtime,
    allowedToolNames: view.allowedTools, maxIterations: view.maxIterations ?? 30, model, bus, agentId: profile.agentId, getConfig: () => config,
    buildChildTools: options => new AgentToolsFactory({ workspace: options.workspace, bus, getConfig: () => config,
      getCurrentContext: () => null, getPrimaryModel: () => model }).createAllTools({ workspace: options.workspace,
      agentId: profile.agentId, conversationId: id, toolAllowlist: profile.config.toolAllowlist, disabledTools: profile.tools.denied }).map(protectDelegatedTool),
  });
  // run() registers ownership synchronously before the first model request.
  void child.run().catch(error => {
    const monitor = monitorChildRun({ ...view, parentConversationId, abort: () => child.abort('user_cancelled') });
    monitor.finish('failed', error instanceof Error ? error.message : String(error));
  });
}
