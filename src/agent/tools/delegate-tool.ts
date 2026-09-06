import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import { createDelegateChildHandle, type BuildChildToolsOptions } from '../child-agent-factory.js';
import { EXTERNAL_TOOL_NAMES } from '../external-tools/index.js';
import { readWorkspaceRevision } from '../coding/workspace-revision.js';
import { LocalWorktreeManager } from '../../execution-environments/local-worktree-manager.js';
import { SessionEnvironmentService } from '../../execution-environments/session-environment-service.js';
import { runGit } from '../../execution-environments/git.js';

export const DEFAULT_DELEGATE_TOOLS = [
  'exec_command',
  'read_file',
  'write_file',
  'apply_patch',
  'grep',
  'find',
  'list_dir',
  'web_search',
  'web_fetch',
] as const;

/** Tools never passed to a delegated sub-agent (even if requested). */
export const DELEGATE_BLOCKED_TOOLS = new Set([
  'delegate_task',
  'clarify',
  'send_message',
  'send_media',
  'todo',
  'session_search',
  'memory_search',
  'memory_get',
  'automation',
  'skills_list',
  'skill_view',
  'skill_manage',
  'skills_marketplace_search',
  'skill_install',
  EXTERNAL_TOOL_NAMES.search,
  EXTERNAL_TOOL_NAMES.describe,
  EXTERNAL_TOOL_NAMES.execute,
  'managed_job',
]);

export interface DelegateToolDeps {
  workspace: string;
  getSubagentModel: () => import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>;
  bus: import('../../infra/bus/index.js').MessageBus;
  getConfig: () => import('../../config/schema.js').Config | undefined;
  getCurrentContext?: () => { sessionKey?: string; channel?: string; accountId?: string; to?: string; threadId?: string | number } | null;
  toolExecutorConfig?: Partial<import('./executor.js').ToolExecutorConfig>;
  /**
   * Construct the child agent's tool set. Injected by `AgentToolsFactory` so
   * the child-agent-factory module does not import `tools/factory.ts`
   * (which would form a factory ↔ delegate-tool ↔ child-agent-factory cycle).
   */
  buildChildTools: (opts: BuildChildToolsOptions) => AgentTool<any, any>[];
}

export const INSPECTION_TOOLS = new Set(['read_file', 'grep', 'find', 'list_dir', 'review_workspace']);
const DelegateTaskSchema = Type.Object({
  goal: Type.String({ minLength: 1 }), context: Type.Optional(Type.String()),
  mode: Type.Optional(Type.Union([Type.Literal('inspect'), Type.Literal('review'), Type.Literal('implement')])),
  toolset: Type.Optional(Type.Array(Type.String())),
  maxIterations: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })),
});

export function delegateToolNames(mode: 'inspect' | 'review' | 'implement', requested?: string[]): string[] {
  const available = mode === 'implement' ? new Set([...DEFAULT_DELEGATE_TOOLS, 'review_workspace', 'language_diagnostics']) : INSPECTION_TOOLS;
  return [...new Set(requested ?? [...available])].filter(name => available.has(name) && !DELEGATE_BLOCKED_TOOLS.has(name));
}

export function createDelegateTool(deps: DelegateToolDeps): AgentTool {
  return {
    name: 'delegate_task', label: 'Delegate task', parameters: DelegateTaskSchema,
    description: 'Run one bounded leaf worker with a fresh context. inspect/review receive only read tools; review reports findings against a workspace revision. implement requires an attached project and clean Git workspace, creates a separate managed worktree, and returns its patch for parent review. Child changes are never merged automatically. No nested delegation, external messages or background jobs. Up to 60 tool calls, 100k tokens and five minutes per child.',
    supportsParallel: false, idempotent: false,
    async execute(_id: string, input: Static<typeof DelegateTaskSchema>, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const mode = input.mode ?? 'inspect';
      const tools = delegateToolNames(mode, input.toolset);
      if (!tools.length) throw new Error('No permitted tools in the requested toolset');
      const parentSessionKey = deps.getCurrentContext?.()?.sessionKey;
      const model = deps.getSubagentModel();
      let workspace = deps.workspace, environmentId: string | undefined;
      if (mode === 'implement') {
        if (!parentSessionKey) throw new Error('Implementation delegation requires a project session');
        const parent = new SessionEnvironmentService().get(parentSessionKey);
        if (!parent?.projectId) throw new Error('Attach this session to a project before implementation delegation');
        const environment = await new LocalWorktreeManager().provisionManagedWorktree({ projectId: parent.projectId, repositoryPath: workspace });
        workspace = environment.rootPath; environmentId = environment.id;
      }
      const revision = await readWorkspaceRevision(workspace);
      const child = createDelegateChildHandle({
        workspace, goal: mode === 'review'
          ? `Independently review the actual changes. Inspect review_workspace and relevant source/tests. Report actionable defects with file and line evidence, severity and a concrete failure example. If there are no findings, state the checks and remaining uncertainty. Do not treat the parent's completion claim as evidence.\n\n${input.goal}` : input.goal,
        context: input.context, requesterSessionKey: parentSessionKey, allowedToolNames: tools,
        maxIterations: input.maxIterations ?? 30, model, bus: deps.bus,
        getConfig: deps.getConfig, toolExecutorConfig: deps.toolExecutorConfig, buildChildTools: deps.buildChildTools,
        verifyChanges: mode === 'implement',
      });
      const abort = () => child.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      try {
        const result = await child.run();
        const currentRevision = await readWorkspaceRevision(workspace);
        const stale = mode !== 'implement' && (!revision || revision !== currentRevision);
        const patch = mode === 'implement' ? await runGit(workspace, ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD']).catch(() => '') : undefined;
        return { content: [{ type: 'text', text: [result.summary,
          stale ? 'Workspace changed or could not be fingerprinted; review findings require revalidation.' : '',
          environmentId ? `Changes retained in ${workspace} (environment ${environmentId}). Review and integrate from this workspace, then verify the parent workspace again.` : '',
          patch ? `Patch preview:\n${patch.slice(0, 30_000)}` : '',
        ].filter(Boolean).join('\n\n') }], details: {
          status: stale && result.status === 'success' ? 'partial' : result.status, mode, summary: result.summary,
          iterations: result.toolIterations, revision: currentRevision, reviewedRevision: revision,
          ...(result.verification ? { childVerification: result.verification } : {}),
          ...(environmentId ? { environmentId, workspace, patchTruncated: (patch?.length ?? 0) > 30_000 } : {}),
        } };
      } catch (error) {
        return { content: [{ type: 'text', text: `Delegation failed: ${String(error)}${environmentId ? `; work retained in ${workspace} (${environmentId})` : ''}` }], details: { status: signal?.aborted ? 'cancelled' : 'failed', ...(environmentId ? { environmentId, workspace } : {}) } };
      } finally { signal?.removeEventListener('abort', abort); }
    },
  } as AgentTool;
}
