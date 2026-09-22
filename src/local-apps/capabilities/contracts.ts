import { ExtensionCapabilityBindingsSchema } from '@xopcai/gateway-contract';
import { CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { registerNoteReadCapabilities } from '../../notes/capabilities/read.js';
import { registerNoteWriteCapabilities } from '../../notes/capabilities/write.js';
import { registerTaskReadCapabilities } from '../../tasks/capabilities/read.js';

/** Validate release bindings against the same production definitions without executing a domain service. */
export function validateLocalAppCapabilityContracts(value: unknown): void {
  const bindings = ExtensionCapabilityBindingsSchema.parse(value ?? []);
  if (!bindings.length) return;
  const dispatcher = new CapabilityDispatcher();
  const unavailable = (): never => { throw new Error('Contract validation must not execute a domain service'); };
  registerNoteReadCapabilities(dispatcher, unavailable);
  registerNoteWriteCapabilities(dispatcher, { getNotes: unavailable });
  registerTaskReadCapabilities(dispatcher);
  const context = { principalId: 'release-validator', surface: 'extension' as const, scopes: ['gateway.admin'] as const, authorize: () => false };
  for (const binding of bindings) {
    const descriptor = dispatcher.describe(binding.id, context);
    if (descriptor.majorVersion !== binding.majorVersion || descriptor.descriptorDigest !== binding.descriptorDigest) {
      throw new Error(`Capability contract changed: ${binding.id}; update the binding and rerun acceptance`);
    }
  }
}
