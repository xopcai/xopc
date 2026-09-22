import { createHash } from 'node:crypto';
import type { CapabilityCall } from '@xopcai/gateway-contract';
import { CapabilityError, type CapabilityContext, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import type { LocalAppService } from '../service.js';

/** Shared UI/Agent execution boundary; callers cannot manufacture grants or release identity. */
export function localAppCapabilities(apps: Pick<LocalAppService, 'getCapabilityAccess'>, dispatcher: CapabilityDispatcher,
  extensionId: string, manifestDigest: string, caller: CapabilityContext) {
  const access = apps.getCapabilityAccess(extensionId, manifestDigest);
  const current = () => {
    if (apps.getCapabilityAccess(extensionId, manifestDigest).releaseId !== access.releaseId) {
      throw new CapabilityError('CONTRACT_CHANGED', 'Local app release changed');
    }
  };
  const context: CapabilityContext = { ...caller, surface: 'extension',
    allowedCapabilities: access.bindings.map(binding => binding.id).filter(id => !caller.allowedCapabilities || caller.allowedCapabilities.includes(id)),
    assertCurrent: () => { caller.assertCurrent?.(); current(); },
    authorize: async (id, input) => { const allowed = await caller.authorize(id, input); current(); return allowed; },
  };
  return {
    list() {
      current();
      return { releaseId: access.releaseId, manifestDigest, capabilities: dispatcher.list(context).filter(item => access.bindings.some(binding =>
        binding.id === item.id && binding.majorVersion === item.majorVersion && binding.descriptorDigest === item.descriptorDigest)) };
    },
    async call(id: string, call: CapabilityCall) {
      current();
      const binding = access.bindings.find(item => item.id === id);
      if (!binding) throw new CapabilityError('FORBIDDEN', 'Capability is not declared by this release');
      if (binding.majorVersion !== call.majorVersion || binding.descriptorDigest !== call.descriptorDigest) {
        throw new CapabilityError('CONTRACT_CHANGED', 'Capability differs from the installed binding');
      }
      const descriptor = dispatcher.describe(id, context);
      const write = descriptor.effect !== 'read';
      if (write && !call.idempotencyKey?.trim()) throw new CapabilityError('INVALID_INPUT', 'A stable idempotencyKey is required');
      const key = call.idempotencyKey ? createHash('sha256').update(JSON.stringify([
        caller.principalId, extensionId, access.releaseId, call.idempotencyKey,
      ])).digest('hex') : undefined;
      const result = await dispatcher.call(id, call.input, context, { ...call, idempotencyKey: key });
      try { current(); } catch (error) {
        if (write) throw new CapabilityError('OUTCOME_UNKNOWN', 'Write may have committed; retain the original idempotencyKey and reconcile after restoring access');
        throw error;
      }
      return { status: 'succeeded' as const, releaseId: access.releaseId, data: result };
    },
  };
}
