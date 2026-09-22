import { z } from 'zod';

/** Declarative bindings to host-owned implementations; never extension-supplied code. */
export const ExtensionCapabilityBindingSchema = z.strictObject({
  id: z.enum(['xopc.notes.get', 'xopc.notes.list', 'xopc.tasks.get', 'xopc.tasks.list',
    'xopc.notes.create', 'xopc.notes.update', 'xopc.notes.append']),
  majorVersion: z.number().int().positive(),
  descriptorDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const ExtensionCapabilityBindingsSchema = z.array(ExtensionCapabilityBindingSchema).max(7)
  .refine(bindings => new Set(bindings.map(binding => binding.id)).size === bindings.length, 'Duplicate capability binding');
export type ExtensionCapabilityBinding = z.infer<typeof ExtensionCapabilityBindingSchema>;

export function extensionCapabilityPermissions(bindings: readonly ExtensionCapabilityBinding[]): string[] {
  return bindings.map(binding => `capability:${binding.id}`);
}
