import { LocalAppAcceptanceInputSchema, LocalAppAcceptanceOutputSchema } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { CapabilityError, defineAtomicCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { LocalAppAcceptanceValidationError, LocalAppRevisionConflictError, type LocalAppService } from '../service.js';

export function registerLocalAppWriteCapabilities(dispatcher: CapabilityDispatcher, service: LocalAppService): void {
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.local_apps.record_acceptance', majorVersion: 1, effect: 'local-write',
    description: 'Record supplied acceptance checks against the exact local source digest; this does not execute the checks.',
    surfaces: ['http', 'agent'], scopes: ['gateway.admin'],
    input: LocalAppAcceptanceInputSchema.extend({ id: z.string().min(1).max(512) }),
    output: z.object({ acceptance: LocalAppAcceptanceOutputSchema }),
    execute({ id, ...input }) {
      if (!service.get(id)) throw new CapabilityError('NOT_FOUND', 'Local app not found');
      try { return { acceptance: service.recordAcceptance(id, input) }; }
      catch (error) {
        if (error instanceof LocalAppRevisionConflictError) throw new CapabilityError('REVISION_CONFLICT', error.message);
        if (error instanceof LocalAppAcceptanceValidationError) throw new CapabilityError('INVALID_INPUT', error.message);
        throw error;
      }
    },
    afterCommit() { service.flushAcceptanceEvents(); },
  }));
}
