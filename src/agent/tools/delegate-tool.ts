import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import { createDelegateChildHandle, type BuildChildToolsOptions } from '../child-agent-factory.js';
import { EXTERNAL_TOOL_NAMES } from '../external-tools/index.js';
import { readWorkspaceRevision } from '../coding/workspace-revision.js';
import { LocalWorktreeManager } from '../../execution-environments/local-worktree-manager.js';
import { SessionEnvironmentService } from '../../execution-environments/session-environment-service.js';
import { runGit } from '../../execution-environments/git.js';
import { DELEGATION_CAPABILITIES, DELEGATION_TOOL_CAPABILITIES, resolveDelegationTools, protectDelegatedTool, type DelegationMode } from './delegation-policy.js';
import type { AgentTurnPolicy } from '../orchestration/agent-turn-policy.js';
import { getDelegationScope } from '../orchestration/delegation-scope.js';

export const DEFAULT_DELEGATE_TOOLS = resolveDelegationTools(Object.keys(DELEGATION_TOOL_CAPABILITIES), 'research').granted;

/** Tools never passed to a delegated sub-agent (even if requested). */
export const DELEGATE_BLOCKED_TOOLS = new Set([
  'delegate_task',
  'clarify',
  'send_message',
  'send_media',
  'todo',
  'user_context_update',
  'knowledge_write',
  'automation',
  'skill_manage',
  'skill_install',
  EXTERNAL_TOOL_NAMES.requireConnection,
  EXTERNAL_TOOL_NAMES.updateConnectionObjective,
  'managed_job',
]);

export interface DelegateToolDeps {
  getParentTools: () => AgentTool<any, any>[];
  createParentPolicy?: () => AgentTurnPolicy;
  workspace: string;
  getSubagentModel: () => import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>;
  bus: import('../../infra/bus/index.js').MessageBus;
  getConfig: () => import('../../config/schema.js').Config | undefined;
  getCurrentContext?: () => { conversationId?: string; channel?: string; accountId?: string; to?: string; threadId?: string | number } | null;
  toolExecutorConfig?: Partial<import('./executor.js').ToolExecutorConfig>;
  /**
   * Construct the child agent's tool set. Injected by `AgentToolsFactory` so
   * the child-agent-factory module does not import `tools/factory.ts`
   * (which would form a factory ↔ delegate-tool ↔ child-agent-factory cycle).
   */
  buildChildTools: (opts: BuildChildToolsOptions) => AgentTool<any, any>[];
}

const DelegateTaskSchema = Type.Object({
  goal: Type.String({ minLength: 1 }), context: Type.Optional(Type.String()),
  mode: Type.Optional(Type.Union(['inspect', 'read', 'research', 'review', 'implement', 'custom'].map(mode => Type.Literal(mode)))),
  capabilities: Type.Optional(Type.Array(Type.Union(DELEGATION_CAPABILITIES.map(capability => Type.Literal(capability))), { description: 'Optional capability subset. custom requires explicit capabilities; browser is always opt-in. Writes and commands require implement.' })),
  toolset: Type.Optional(Type.Array(Type.String())),
  maxIterations: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })),
});

export function delegateToolNames(mode: DelegationMode, requested?: string[]): string[] {
  return resolveDelegationTools(Object.keys(DELEGATION_TOOL_CAPABILITIES), mode, requested).granted;
}

export function createDelegateTool(deps: DelegateToolDeps): AgentTool {
  return {
    name: 'delegate_task', label: 'Delegate task', parameters: DelegateTaskSchema,
    description: 'Delegate a bounded task with a fresh context; supply relevant facts and constraints in context. Default research inherits the parent\'s local, web, knowledge, skill and approved external read tools. read/inspect/review are local read-only. toolset and capabilities only narrow parent access; custom requires explicit capabilities. Browser interaction is opt-in. implement requires a project and clean Git workspace and returns changes in a separate worktree for review. No nested delegation, external writes, installation or background jobs. Up to 60 tool calls, 100k tokens and five minutes. Reports rejected tools and their reasons.',
    supportsParallel: false, idempotent: false,
    async execute(_id: string, input: Static<typeof DelegateTaskSchema>, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const mode = (input.mode ?? 'research') as DelegationMode;
      const scope = getDelegationScope();
      const parentTools = scope?.tools ?? deps.getParentTools();
      const access = resolveDelegationTools(parentTools.map(tool => tool.name), mode, input.toolset, input.capabilities);
      const tools = access.granted;
      if (!tools.length) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No permitted tools in the requested delegation', ...access }) }],
        details: { status: 'failed', mode, grantedTools: tools, rejectedTools: access.rejected } };
      const parentConversationId = deps.getCurrentContext?.()?.conversationId;
      const model = deps.getSubagentModel();
      let workspace = deps.workspace, environmentId: string | undefined;
      if (mode === 'implement') {
        if (!parentConversationId) throw new Error('Implementation delegation requires a project session');
        const parent = new SessionEnvironmentService().get(parentConversationId);
        if (!parent?.projectId) throw new Error('Attach this session to a project before implementation delegation');
        const environment = await new LocalWorktreeManager().provisionManagedWorktree({ projectId: parent.projectId, repositoryPath: workspace });
        workspace = environment.rootPath; environmentId = environment.id;
      }
      const revision = mode === 'review' ? await readWorkspaceRevision(workspace) : undefined;
      const authorizeToolCall = scope?.authorizeToolCall ?? deps.createParentPolicy?.().beforeToolCall;
      const child = createDelegateChildHandle({
        workspace, goal: mode === 'review'
          ? `Independently review the actual changes. Inspect review_workspace and relevant source/tests. Report actionable defects with file and line evidence, severity and a concrete failure example. If there are no findings, state the checks and remaining uncertainty. Do not treat the parent's completion claim as evidence.\n\n${input.goal}` : input.goal,
        context: input.context, requesterConversationId: parentConversationId, allowedToolNames: tools,
        maxIterations: input.maxIterations ?? 30, model, bus: deps.bus,
        getConfig: deps.getConfig, toolExecutorConfig: deps.toolExecutorConfig,
        authorizeToolCall,
        buildChildTools: opts => {
          const local = mode === 'implement' ? new Map(deps.buildChildTools(opts).map(tool => [tool.name, tool])) : undefined;
          const rebound = new Set(['read_file', 'grep', 'find', 'list_dir', 'review_workspace', 'write_file', 'apply_patch', 'exec_command', 'language_diagnostics']);
          return parentTools.flatMap(tool => {
            const candidate = local && rebound.has(tool.name) ? local.get(tool.name) : tool;
            return candidate ? [protectDelegatedTool(candidate)] : [];
          });
        },
        verifyChanges: mode === 'implement',
      });
      const abort = () => child.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      try {
        const result = await child.run();
        const currentRevision = mode === 'review' ? await readWorkspaceRevision(workspace) : undefined;
        const stale = mode === 'review' && (!revision || revision !== currentRevision);
        const patch = mode === 'implement' ? await runGit(workspace, ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD']).catch(() => '') : undefined;
        return { content: [{ type: 'text', text: [result.summary,
          stale ? 'Workspace changed or could not be fingerprinted; review findings require revalidation.' : '',
          access.rejected.length ? `Rejected tools: ${JSON.stringify(access.rejected)}` : '',
          environmentId ? `Changes retained in ${workspace} (environment ${environmentId}). Review and integrate from this workspace, then verify the parent workspace again.` : '',
          patch ? `Patch preview:\n${patch.slice(0, 30_000)}` : '',
        ].filter(Boolean).join('\n\n') }], details: {
          status: stale && result.status === 'success' ? 'partial' : result.status, mode, summary: result.summary,
          grantedTools: tools, rejectedTools: access.rejected,
          iterations: result.toolIterations, revision: currentRevision, reviewedRevision: revision,
          ...(result.verification ? { childVerification: result.verification } : {}),
          ...(environmentId ? { environmentId, workspace, patchTruncated: (patch?.length ?? 0) > 30_000 } : {}),
        } };
      } catch (error) {
        return { content: [{ type: 'text', text: `Delegation failed: ${String(error)}${environmentId ? `; work retained in ${workspace} (${environmentId})` : ''}` }], details: { status: signal?.aborted ? 'cancelled' : 'failed', mode,
          grantedTools: tools, rejectedTools: access.rejected, ...(environmentId ? { environmentId, workspace } : {}) } };
      } finally { signal?.removeEventListener('abort', abort); }
    },
  } as AgentTool;
}
