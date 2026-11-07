import { z } from 'zod';

const resourceIds = z.array(z.string().trim().min(1).max(512)).max(200)
  .refine(ids => new Set(ids).size === ids.length, 'Duplicate resource ID');
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
    'xopc.notes.create', 'xopc.notes.update', 'xopc.notes.append', 'xopc.agent.delegate']),
  majorVersion: z.number().int().positive(),
  descriptorDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const ExtensionCapabilityBindingsSchema = z.array(ExtensionCapabilityBindingSchema).max(8)
  .refine(bindings => new Set(bindings.map(binding => binding.id)).size === bindings.length, 'Duplicate capability binding');
export type ExtensionCapabilityBinding = z.infer<typeof ExtensionCapabilityBindingSchema>;

export function extensionCapabilityPermissions(bindings: readonly ExtensionCapabilityBinding[]): string[] {
  return bindings.map(binding => `capability:${binding.id}`);
}
