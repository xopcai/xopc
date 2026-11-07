import { createHash } from 'node:crypto';
import type { CapabilityCall, LocalAppDelegateInput } from '@xopcai/gateway-contract';
import { CapabilityError, type CapabilityContext, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import type { LocalAppService } from '../service.js';
import { localAppResourceAllowed } from './resource-policy.js';
import { recordLocalAppAccess } from '../access-audit.js';

/** Shared UI/Agent execution boundary; callers cannot manufacture grants or release identity. */
export function localAppCapabilities(apps: Pick<LocalAppService, 'getCapabilityAccess'>, dispatcher: CapabilityDispatcher,
  extensionId: string, manifestDigest: string, caller: CapabilityContext, grantRevision?: string) {
  let access: ReturnType<LocalAppService['getCapabilityAccess']>;
  try { access = apps.getCapabilityAccess(extensionId, manifestDigest, grantRevision); }
  catch (error) {
    recordLocalAppAccess(extensionId, { principalId: caller.principalId, surface: caller.surface, action: 'authorize', status: 'denied',
      code: error instanceof CapabilityError ? error.code : 'INTERNAL', grantRevision });
    throw error;
  }
  const current = () => {
    const next = apps.getCapabilityAccess(extensionId, manifestDigest, grantRevision);
    if (next.releaseId !== access.releaseId) {
      throw new CapabilityError('CONTRACT_CHANGED', 'Local app release changed');
    }
    if (next.grantRevision !== access.grantRevision) throw new CapabilityError('FORBIDDEN', 'Local app authorization changed');
  };
  const makeContext = (): CapabilityContext => {
    let activeInput: { id: string; input: unknown } | undefined;
    return { ...caller, surface: 'extension',
      localApp: { extensionId, resourceScopes: access.resourceScopes, bindings: access.bindings,
        releaseId: access.releaseId, grantRevision: access.grantRevision },
      allowedCapabilities: access.bindings.map(binding => binding.id).filter(id => !caller.allowedCapabilities || caller.allowedCapabilities.includes(id)),
      assertCurrent: () => {
        caller.assertCurrent?.(); current();
        if (activeInput && !localAppResourceAllowed(extensionId, access.resourceScopes, activeInput.id, activeInput.input)) {
          throw new CapabilityError('FORBIDDEN', 'Local app resource access denied');
        }
      },
      authorize: async (id, input) => {
        const allowed = await caller.authorize(id, input); current();
        activeInput = { id, input };
        return allowed && localAppResourceAllowed(extensionId, access.resourceScopes, id, input);
      },
    };
  };
  return {
    list() {
      current();
      return { releaseId: access.releaseId, manifestDigest, grantRevision: access.grantRevision, capabilities: dispatcher.list(makeContext()).filter(item => access.bindings.some(binding =>
        binding.id === item.id && binding.majorVersion === item.majorVersion && binding.descriptorDigest === item.descriptorDigest)) };
    },
    async call(id: string, call: CapabilityCall) {
      const context = makeContext();
      const audit = { principalId: caller.principalId, surface: caller.surface, action: id, releaseId: access.releaseId, grantRevision: access.grantRevision,
        resourceId: call.input && typeof call.input === 'object' && 'id' in call.input && typeof call.input.id === 'string' ? call.input.id : undefined };
      try {
        current();
        const binding = access.bindings.find(item => item.id === id);
        if (!binding) throw new CapabilityError('FORBIDDEN', 'Capability is not declared by this release');
        if (binding.majorVersion !== call.majorVersion || binding.descriptorDigest !== call.descriptorDigest) {
          throw new CapabilityError('CONTRACT_CHANGED', 'Capability differs from the installed binding');
        }
        const descriptor = dispatcher.describe(id, context);
        const write = descriptor.effect !== 'read';
        if (write && !call.idempotencyKey?.trim()) throw new CapabilityError('INVALID_INPUT', 'A stable idempotencyKey is required');
        if (id === 'xopc.agent.delegate') {
          const input = await dispatcher.validateInput(id, call.input, context) as LocalAppDelegateInput;
          for (const source of input.sources) {
            const binding = access.bindings.find(item => item.id === source.capabilityId);
            if (!binding) throw new CapabilityError('FORBIDDEN', 'Referenced read capability is not declared');
            const contract = dispatcher.describe(source.capabilityId, context);
            if (contract.majorVersion !== binding.majorVersion || contract.descriptorDigest !== binding.descriptorDigest) {
              throw new CapabilityError('CONTRACT_CHANGED', 'Referenced read contract changed');
            }
            await dispatcher.validateInput(source.capabilityId, { id: source.id }, context);
          }
        }
        const key = call.idempotencyKey ? createHash('sha256').update(JSON.stringify([
          caller.principalId, extensionId, call.idempotencyKey,
        ])).digest('hex') : undefined;
        const result = await dispatcher.call(id, call.input, context, { ...call, idempotencyKey: key });
        try { context.assertCurrent?.(); } catch (error) {
          if (write) throw new CapabilityError('OUTCOME_UNKNOWN', 'Write may have committed; retain the original idempotencyKey and reconcile after restoring access');
          throw error;
        }
        const items = result && typeof result === 'object' && 'items' in result && Array.isArray(result.items) ? result.items : [];
        const resourceIds = items.map(item => item?.id ?? item?.task?.id).filter((item): item is string => typeof item === 'string');
        const operationId = result && typeof result === 'object' && 'operationId' in result && typeof result.operationId === 'string' ? result.operationId : undefined;
        recordLocalAppAccess(extensionId, { ...audit, resourceIds, operationId, status: 'succeeded' });
        return { status: 'succeeded' as const, releaseId: access.releaseId, data: result };
      } catch (error) {
        recordLocalAppAccess(extensionId, { ...audit, status: error instanceof CapabilityError && ['FORBIDDEN', 'NOT_FOUND'].includes(error.code) ? 'denied' : 'failed',
          code: error instanceof CapabilityError ? error.code : 'INTERNAL', operationId: error instanceof CapabilityError ? error.operationId : undefined });
        throw error;
      }
    },
  };
}
