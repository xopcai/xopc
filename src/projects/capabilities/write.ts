import { ProjectResolveWorkspaceInputSchema, ProjectResolveWorkspaceOutputSchema, ProjectCreateInputSchema, ProjectEditInputSchema, ProjectDeleteInputSchema, ProjectDeleteOutputSchema, ProjectSetPinnedInputSchema, ProjectMutationOutputSchema, ProjectMilestoneCreateInputSchema, ProjectMilestoneUpdateInputSchema, ProjectMilestoneDeleteInputSchema,
  ProjectMilestoneOutputSchema, ProjectMilestoneDeleteOutputSchema, ProjectUpdateCreateInputSchema, ProjectUpdateOutputSchema } from '@xopcai/gateway-contract';

import { CapabilityError, defineAtomicCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { ProjectDeletionBlockedError, ProjectWorkspaceInvalidError, ProjectWorkspaceInUseError, type ProjectService } from '../project-service.js';
import type { Config } from '../../config/schema.js';
import type { WorkDiscoveryService } from '../../work-discovery/service.js';
import { isValidProjectAgentId, normalizeProjectAgentId } from '../project-agent.js';
import { inferSuggestedProjectDefaultAgentId } from '../project-agent-suggestion.js';
import { ProjectWorkspaceConflictError, ProjectWorkspaceMissingError } from '../workspace-project.js';
import { ensureSessionRecord, getSessionMetadata } from '../../storage/sqlite/index.js';

export interface ProjectWriteCapabilityDeps {
  getConfig?: () => Config | undefined;
  getWorkDiscovery?: () => WorkDiscoveryService | undefined;
}

function projectMutation<T>(execute: () => T): T {
  try { return execute(); }
  catch (error) {
    if (error instanceof ProjectWorkspaceInvalidError) throw new CapabilityError('INVALID_INPUT', error.message);
    if (error instanceof ProjectWorkspaceConflictError || error instanceof ProjectWorkspaceMissingError || error instanceof ProjectWorkspaceInUseError) {
      const conflict = new CapabilityError('REVISION_CONFLICT', error.message);
      conflict.cause = error;
      throw conflict;
    }
    throw error;
  }
}

export function registerProjectWriteCapabilities(dispatcher: CapabilityDispatcher, service: ProjectService, deps: ProjectWriteCapabilityDeps = {}): void {
  const policy = { majorVersion: 1, effect: 'local-write' as const, surfaces: ['http', 'agent'] as const, scopes: ['workspace.write'] as const,
    afterCommit: () => service.flushCommittedEffects() };
  const requireProject = (id: string) => {
    const project = service.get(id);
    if (!project) throw new CapabilityError('NOT_FOUND', 'Project not found');
    return project;
  };
  const agentId = (raw: string | null | undefined) => {
    const normalized = normalizeProjectAgentId(raw);
    const config = deps.getConfig?.();
    if (normalized && !config) throw new CapabilityError('UNAVAILABLE', 'Agent configuration is unavailable');
    if (config && !isValidProjectAgentId(config, normalized)) throw new CapabilityError('INVALID_INPUT', 'Default agent not found');
    return normalized;
  };
  const flushWorkspace = (projectId: string) => {
    try { service.flushCommittedEffects(projectId); }
    catch (error) {
      const pending = new CapabilityError('UNAVAILABLE', 'Project committed; workspace creation is pending. Retry the same idempotencyKey.');
      pending.cause = error;
      throw pending;
    }
  };
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.projects.create', description: 'Create a project with a durable receipt and recoverable post-commit workspace creation.',
    input: ProjectCreateInputSchema, output: ProjectMutationOutputSchema,
    execute({ autoUnderstand, ...input }) {
      const understanding = autoUnderstand ? deps.getWorkDiscovery?.() : undefined;
      if (autoUnderstand && !understanding) throw new CapabilityError('UNAVAILABLE', 'Project understanding service is unavailable');
      const config = deps.getConfig?.();
      const defaultAgentId = input.defaultAgentId !== undefined ? agentId(input.defaultAgentId)
        : config ? inferSuggestedProjectDefaultAgentId({ config, ...input }) : undefined;
      const project = projectMutation(() => service.create({ ...input, defaultAgentId }));
      understanding?.startProjectUnderstanding(project.id);
      return { ok: true as const, project: { ...project } };
    },
    afterCommit: result => flushWorkspace(result.project.id),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.projects.update', description: 'Edit a project at its exact version with recoverable workspace creation.',
    input: ProjectEditInputSchema, output: ProjectMutationOutputSchema,
    execute({ id, expectedVersion, patch }) {
      if (requireProject(id).version !== expectedVersion) throw new CapabilityError('REVISION_CONFLICT', 'Project changed');
      const defaultAgentId = patch.defaultAgentId === undefined ? undefined : agentId(patch.defaultAgentId) ?? null;
      const project = projectMutation(() => service.update(id, { ...patch, ...(patch.defaultAgentId === undefined ? {} : { defaultAgentId }) }));
      return { ok: true as const, project: { ...project } };
    },
    afterCommit: result => flushWorkspace(result.project.id),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.projects.resolve_workspace', description: 'Resolve or create a workspace project and optionally bind an unassigned conversation atomically.',
    input: ProjectResolveWorkspaceInputSchema, output: ProjectResolveWorkspaceOutputSchema,
    execute(input) {
      const config = deps.getConfig?.();
      const existing = input.conversationId ? getSessionMetadata(input.conversationId) : undefined;
      // Existing conversation routing is authoritative, never the caller's hint.
      const requestedAgent = existing ? existing.routing?.agentId || existing.agentId : input.agentId;
      const resolvedAgent = requestedAgent ? agentId(requestedAgent) ?? undefined : undefined;
      const defaultAgentId = input.defaultAgentId !== undefined ? agentId(input.defaultAgentId) ?? undefined
        : config ? inferSuggestedProjectDefaultAgentId({ config, workspaceRoot: input.workspacePath, projectKind: input.projectKind }) : resolvedAgent;
      const match = projectMutation(() => service.resolveOrCreateForWorkspacePath({ ...input, agentId: resolvedAgent, defaultAgentId }));
      if (!match) return { ok: true as const, project: null };
      const projectAgent = normalizeProjectAgentId(match.project.defaultAgentId);
      if (input.conversationId && (!projectAgent || projectAgent === resolvedAgent)) {
        if (existing?.projectId && existing.projectId !== match.project.id) {
          throw new CapabilityError('REVISION_CONFLICT', 'Conversation is already bound to another project');
        }
        if (!existing) ensureSessionRecord(input.conversationId, match.project.workspaceRoot ?? input.workspacePath, {
          sourceChannel: 'tui', sourceChatId: `default:direct:${input.conversationId}`, sessionType: 'chat',
          routing: { agentId: resolvedAgent ?? 'main', source: 'tui', accountId: 'default', peerKind: 'direct', peerId: input.conversationId },
        });
        if (existing?.projectId !== match.project.id) service.attachSession(input.conversationId, match.project.id);
      }
      return { ok: true as const, ...match, project: { ...service.get(match.project.id)! } };
    },
  }));
  const requireMilestone = (projectId: string, id: string, revision: number) => {
    requireProject(projectId);
    const milestone = service.listMilestones(projectId).find(item => item.id === id);
    if (!milestone) throw new CapabilityError('NOT_FOUND', 'Milestone not found');
    if (milestone.updatedAt !== revision) throw new CapabilityError('REVISION_CONFLICT', 'Milestone changed');
  };
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.projects.delete', description: 'Delete a project at its exact version without removing workspace files. External execution stop is not confirmed.',
    input: ProjectDeleteInputSchema, output: ProjectDeleteOutputSchema,
    execute({ id, expectedVersion }) {
      if (requireProject(id).version !== expectedVersion) throw new CapabilityError('REVISION_CONFLICT', 'Project changed');
      try { service.delete(id); }
      catch (error) {
        if (error instanceof ProjectDeletionBlockedError) {
          const conflict = new CapabilityError('REVISION_CONFLICT', error.message);
          conflict.cause = error;
          throw conflict;
        }
        throw error;
      }
      return { ok: true as const, deleted: true as const, executionStopConfirmed: false as const };
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.projects.set_pinned', description: 'Pin or unpin a project at its exact version with a durable receipt.',
    input: ProjectSetPinnedInputSchema, output: ProjectMutationOutputSchema,
    execute({ id, expectedVersion, pinned }) {
      if (requireProject(id).version !== expectedVersion) throw new CapabilityError('REVISION_CONFLICT', 'Project changed');
      return { ok: true as const, project: { ...(pinned ? service.pin(id) : service.unpin(id)) } };
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.projects.create_milestone', description: 'Create a project milestone with a durable receipt.',
    input: ProjectMilestoneCreateInputSchema, output: ProjectMilestoneOutputSchema,
    execute({ projectId, ...input }) {
      requireProject(projectId);
      const milestone = service.createMilestone(projectId, input);
      return { ok: true as const, milestone: { ...milestone }, project: { ...requireProject(projectId) } };
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.projects.update_milestone', description: 'Edit a milestone at its exact updatedAt revision.',
    input: ProjectMilestoneUpdateInputSchema, output: ProjectMilestoneOutputSchema,
    execute({ projectId, id, expectedRevision, patch }) {
      requireMilestone(projectId, id, expectedRevision);
      return { ok: true as const, milestone: { ...service.updateMilestone(projectId, id, patch) }, project: { ...requireProject(projectId) } };
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.projects.delete_milestone', description: 'Delete a milestone at its exact updatedAt revision.',
    input: ProjectMilestoneDeleteInputSchema, output: ProjectMilestoneDeleteOutputSchema,
    execute({ projectId, id, expectedRevision }) {
      requireMilestone(projectId, id, expectedRevision);
      service.deleteMilestone(projectId, id);
      return { ok: true as const, deleted: true as const };
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.projects.create_update', description: 'Record progress and change project health at an exact project version.',
    input: ProjectUpdateCreateInputSchema, output: ProjectUpdateOutputSchema,
    execute({ projectId, expectedVersion, ...input }, context) {
      if (requireProject(projectId).version !== expectedVersion) throw new CapabilityError('REVISION_CONFLICT', 'Project changed');
      const update = service.createUpdate(projectId, { ...input, actor: context.actor ?? { kind: 'system' } });
      return { ok: true as const, update: { ...update }, project: { ...requireProject(projectId) } };
    },
  }));
}
