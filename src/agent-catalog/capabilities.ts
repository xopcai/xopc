import { z } from 'zod';

import {
  AgentEntrySchema,
  EffectiveAgentConfigSchema,
  resolveEffectiveAgentConfig,
  type AgentEntry,
} from '../agent-config/index.js';
import {
  CapabilityError,
  defineAtomicCapability,
  defineReadCapability,
  type CapabilityDispatcher,
} from '../capabilities/runtime/dispatcher.js';
import { resolveAgentWorkspaceDir } from '../agent/agent-scope.js';
import { AgentCatalogRepository } from './repository.js';
import { AgentCatalogService } from './service.js';
import type { StoredAgent } from './types.js';

const AgentIdInputSchema = z.strictObject({ id: AgentEntrySchema.shape.id });
const EmptyInputSchema = z.strictObject({});
const StoredAgentSchema = AgentEntrySchema.extend({
  revision: z.number().int().positive(),
  provisioningState: z.enum(['pending', 'ready', 'error']),
  provisioningError: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().optional(),
});
const AgentViewSchema = z.object({
  agent: StoredAgentSchema,
  effective: EffectiveAgentConfigSchema,
});
const AgentMutationOutputSchema = AgentViewSchema.extend({ ok: z.literal(true) });
const AgentListOutputSchema = z.object({
  ok: z.literal(true),
  defaultAgentId: AgentEntrySchema.shape.id,
  catalogRevision: z.number().int().positive(),
  agents: z.array(AgentViewSchema),
});
const AgentUpdateInputSchema = z.strictObject({
  id: AgentEntrySchema.shape.id,
  expectedRevision: z.number().int().positive(),
  patch: AgentEntrySchema.omit({ id: true }).partial(),
});
const AgentSetDefaultInputSchema = z.strictObject({
  id: AgentEntrySchema.shape.id,
  expectedRevision: z.number().int().positive(),
});
const AgentDeleteOutputSchema = z.object({
  ok: z.literal(true),
  deleted: z.literal(true),
  agent: StoredAgentSchema,
  removedBindings: z.number().int().nonnegative(),
});

function effective(repository: AgentCatalogRepository, agent: AgentEntry) {
  const stored = agent as StoredAgent;
  const { revision: _revision, provisioningState: _state, provisioningError: _error,
    createdAt: _created, updatedAt: _updated, deletedAt: _deleted, ...entry } = stored;
  return resolveEffectiveAgentConfig({
    defaults: repository.getSettings().defaults,
    agent: entry,
    defaultWorkspace: resolveAgentWorkspaceDir,
  }).config;
}

function view(repository: AgentCatalogRepository, agent: StoredAgent) {
  return { agent, effective: effective(repository, agent) };
}

function requireAgent(repository: AgentCatalogRepository, id: string): StoredAgent {
  const agent = repository.get(id);
  if (!agent) throw new CapabilityError('NOT_FOUND', `Agent "${id}" not found`);
  return agent;
}

function translateMutationError<T>(execute: () => T): T {
  try {
    return execute();
  } catch (error) {
    if (error instanceof CapabilityError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const code = /not found/i.test(message) ? 'NOT_FOUND'
      : /conflict|already exists|default Agent|cannot be disabled|not available/i.test(message)
        ? 'REVISION_CONFLICT'
        : 'INVALID_INPUT';
    throw new CapabilityError(code, message);
  }
}

/** Register Agent catalog operations for UI, HTTP, CLI, and conversational tools. */
export function registerAgentCapabilities(dispatcher: CapabilityDispatcher): void {
  const repository = new AgentCatalogRepository();
  const service = new AgentCatalogService(repository);
  const readPolicy = {
    majorVersion: 1,
    effect: 'read' as const,
    surfaces: ['http', 'agent', 'cli'] as const,
    scopes: ['agents.read'] as const,
  };
  const writePolicy = {
    majorVersion: 1,
    effect: 'local-write' as const,
    surfaces: ['http', 'agent', 'cli'] as const,
    scopes: ['gateway.admin'] as const,
  };

  dispatcher.register(defineReadCapability({
    ...readPolicy,
    id: 'xopc.agents.list',
    description: 'List Agent definitions with their effective inherited configuration.',
    input: EmptyInputSchema,
    output: AgentListOutputSchema,
    execute() {
      const settings = repository.getSettings();
      return {
        ok: true as const,
        defaultAgentId: settings.defaultAgentId,
        catalogRevision: settings.revision,
        agents: repository.list().map(agent => view(repository, agent)),
      };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...readPolicy,
    id: 'xopc.agents.get',
    description: 'Read one Agent definition and its effective inherited configuration.',
    input: AgentIdInputSchema,
    output: AgentMutationOutputSchema,
    execute({ id }) {
      return { ok: true as const, ...view(repository, requireAgent(repository, id)) };
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...writePolicy,
    id: 'xopc.agents.create',
    description: 'Create a complete Agent definition and queue recoverable directory provisioning.',
    input: AgentEntrySchema,
    output: AgentMutationOutputSchema,
    execute(input) {
      const agent = translateMutationError(() => repository.create(input));
      return { ok: true as const, ...view(repository, agent) };
    },
    afterCommit: () => service.resumePendingProvisioning(),
  }));
  dispatcher.register(defineAtomicCapability({
    ...writePolicy,
    id: 'xopc.agents.update',
    description: 'Update an Agent at an exact revision.',
    input: AgentUpdateInputSchema,
    output: AgentMutationOutputSchema,
    execute({ id, expectedRevision, patch }) {
      const current = requireAgent(repository, id);
      const { revision: _revision, provisioningState: _state, provisioningError: _error,
        createdAt: _created, updatedAt: _updated, deletedAt: _deleted, ...entry } = current;
      const agent = translateMutationError(() => repository.update(
        id,
        expectedRevision,
        { ...entry, ...patch, id },
        { reprovision: true },
      ));
      return { ok: true as const, ...view(repository, agent) };
    },
    afterCommit: () => service.resumePendingProvisioning(),
  }));
  dispatcher.register(defineAtomicCapability({
    ...writePolicy,
    id: 'xopc.agents.set_default',
    description: 'Select the global default Agent at an exact catalog revision.',
    input: AgentSetDefaultInputSchema,
    output: z.object({ ok: z.literal(true), defaultAgentId: AgentEntrySchema.shape.id, catalogRevision: z.number().int().positive() }),
    execute({ id, expectedRevision }) {
      const settings = translateMutationError(() => repository.setDefault(id, expectedRevision));
      return { ok: true as const, defaultAgentId: settings.defaultAgentId, catalogRevision: settings.revision };
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...writePolicy,
    id: 'xopc.agents.disable',
    description: 'Disable a non-default Agent at an exact revision.',
    input: z.strictObject({ id: AgentEntrySchema.shape.id, expectedRevision: z.number().int().positive() }),
    output: AgentMutationOutputSchema,
    execute({ id, expectedRevision }) {
      const current = requireAgent(repository, id);
      const { revision: _revision, provisioningState: _state, provisioningError: _error,
        createdAt: _created, updatedAt: _updated, deletedAt: _deleted, ...entry } = current;
      const agent = translateMutationError(() => repository.update(id, expectedRevision, { ...entry, enabled: false, id }));
      return { ok: true as const, ...view(repository, agent) };
    },
  }));

  for (const purge of [false, true]) {
    dispatcher.register(defineAtomicCapability({
      ...writePolicy,
      id: purge ? 'xopc.agents.purge' : 'xopc.agents.delete',
      description: purge
        ? 'Delete an Agent and remove its state and workspace after commit.'
        : 'Delete an Agent definition without removing workspace files.',
      input: z.strictObject({ id: AgentEntrySchema.shape.id, expectedRevision: z.number().int().positive() }),
      output: AgentDeleteOutputSchema,
      ...(purge ? { prepare: ({ id, expectedRevision }: { id: string; expectedRevision: number }) => {
        const current = requireAgent(repository, id);
        if (current.revision !== expectedRevision) throw new CapabilityError('REVISION_CONFLICT', 'Agent changed');
        service.validatePurgeEntry(current, repository.getSettings().defaultAgentId);
      } } : {}),
      execute({ id, expectedRevision }) {
        const current = requireAgent(repository, id);
        if (current.revision !== expectedRevision) throw new CapabilityError('REVISION_CONFLICT', 'Agent changed');
        const result = translateMutationError(() => repository.delete(id, { purge }));
        return { ok: true as const, deleted: true as const, agent: result.agent, removedBindings: result.removedBindings };
      },
      ...(purge ? { afterCommit: async () => {
        const failed = await service.resumePendingPurge();
        if (failed.length) throw new CapabilityError('UNAVAILABLE', 'Agent was deleted; data purge is pending retry');
      } } : {}),
    }));
  }
}
