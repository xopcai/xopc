import { z } from 'zod';

const resourceIds = z.array(z.string().trim().min(1).max(512)).max(200)
  .refine(ids => new Set(ids).size === ids.length, 'Duplicate resource ID');
export const LocalAppExecutionAuthoritySchema = z.strictObject({
  model: z.boolean().default(false), tools: z.boolean().default(false),
  dataWrite: z.boolean().default(false), externalSend: z.boolean().default(false),
  expiresAt: z.number().int().nonnegative().default(0),
  maxRuns: z.number().int().min(0).max(100).default(0),
  maxCostMicrousd: z.number().int().min(0).max(100_000_000).default(0),
});
export type LocalAppExecutionAuthority = z.infer<typeof LocalAppExecutionAuthoritySchema>;
export const LocalAppResourceScopeSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('none') }),
  z.strictObject({ mode: z.literal('workspace') }),
  z.strictObject({ mode: z.literal('selected'), ids: resourceIds.default([]),
    projectIds: resourceIds.default([]), includeCreated: z.boolean().default(false) }),
]);
export const LocalAppResourceScopesSchema = z.strictObject({
  notesRead: LocalAppResourceScopeSchema.default({ mode: 'none' }),
  notesWrite: LocalAppResourceScopeSchema.default({ mode: 'none' }),
  tasksRead: LocalAppResourceScopeSchema.default({ mode: 'none' }),
  tasksWrite: LocalAppResourceScopeSchema.default({ mode: 'none' }),
  projectsRead: LocalAppResourceScopeSchema.default({ mode: 'none' }),
  projectsWrite: LocalAppResourceScopeSchema.default({ mode: 'none' }),
  filesRead: z.discriminatedUnion('mode', [z.strictObject({ mode: z.literal('none') }),
    z.strictObject({ mode: z.literal('selected'), ids: z.array(z.string().min(1).max(4096)).max(200)
      .refine(ids => new Set(ids).size === ids.length, 'Duplicate file ID').default([]) })]).default({ mode: 'none' }),
  filesExport: z.boolean().default(false),
  filesImport: z.boolean().default(false),
  connectors: z.discriminatedUnion('mode', [z.strictObject({ mode: z.literal('none') }), z.strictObject({ mode: z.literal('selected'),
    bindings: z.array(z.strictObject({ toolRef: z.string().min(1).max(1024), connectorId: z.string().min(1).max(200),
      accountId: z.string().min(1).max(200), connectionId: z.string().min(1).max(200), revision: z.string().regex(/^[a-f0-9]{16}$/),
      scope: z.enum(['read', 'write']) })).max(100).refine(items => new Set(items.map(item => `${item.toolRef}:${item.accountId}`)).size === items.length, 'Duplicate connector binding'),
  })]).default({ mode: 'none' }),
  automationsRead: LocalAppResourceScopeSchema.default({ mode: 'none' }),
  automationProposals: z.boolean().default(false),
  automationsRun: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('none') }),
    z.strictObject({ mode: z.literal('selected'), approvals: z.array(z.strictObject({
      id: z.string().trim().min(1).max(512), configurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
      authority: LocalAppExecutionAuthoritySchema.prefault({}),
    })).max(200).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Duplicate automation approval') }),
  ]).default({ mode: 'none' }),
  agentDelegate: z.boolean().default(false),
});
export type LocalAppResourceScope = z.infer<typeof LocalAppResourceScopeSchema>;
export type LocalAppResourceScopes = z.infer<typeof LocalAppResourceScopesSchema>;
export const ExtensionUiGrantInputSchema = z.strictObject({
  manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  resourceScopes: LocalAppResourceScopesSchema.optional(),
});

/** Declarative bindings to host-owned implementations; never extension-supplied code. */
export const ExtensionCapabilityBindingSchema = z.strictObject({
  id: z.enum(['xopc.notes.get', 'xopc.notes.list', 'xopc.tasks.get', 'xopc.tasks.list',
    'xopc.notes.create', 'xopc.notes.update', 'xopc.notes.append', 'xopc.agent.delegate',
    'xopc.automations.list', 'xopc.automations.get', 'xopc.automations.run', 'xopc.automations.get_run', 'xopc.automations.cancel',
    'xopc.automations.simulate', 'xopc.automations.propose', 'xopc.automations.get_proposal', 'xopc.automations.history', 'xopc.automations.run_events',
    'xopc.projects.get', 'xopc.projects.list', 'xopc.projects.list_milestones', 'xopc.projects.list_updates',
    'xopc.projects.update', 'xopc.projects.create_milestone', 'xopc.projects.update_milestone', 'xopc.projects.create_update',
    'xopc.tasks.create', 'xopc.tasks.update', 'xopc.files.read', 'xopc.files.propose_export',
    'xopc.connectors.describe', 'xopc.connectors.read', 'xopc.connectors.propose_write', 'xopc.apps.get_request']),
  majorVersion: z.number().int().positive(),
  descriptorDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const ExtensionCapabilityBindingsSchema = z.array(ExtensionCapabilityBindingSchema).max(34)
  .refine(bindings => new Set(bindings.map(binding => binding.id)).size === bindings.length, 'Duplicate capability binding');
export type ExtensionCapabilityBinding = z.infer<typeof ExtensionCapabilityBindingSchema>;

export function extensionCapabilityPermissions(bindings: readonly ExtensionCapabilityBinding[]): string[] {
  return bindings.map(binding => `capability:${binding.id}`);
}
