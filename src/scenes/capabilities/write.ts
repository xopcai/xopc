import { SceneWriteContracts } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { CapabilityError, defineAtomicCapability, type CapabilityContext, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import type { SceneAccess } from '../httpServices.js';
import { SceneConflictError, SceneInputError, SceneNotFoundError } from '../repository.js';
import { SceneSetupError } from '../service.js';

export function registerSceneWriteCapabilities(dispatcher: CapabilityDispatcher, getAccess: (context: CapabilityContext) => SceneAccess | undefined): void {
  const policy = { majorVersion: 1, effect: 'local-write' as const, surfaces: ['http', 'agent'] as const, scopes: ['gateway.admin'] as const,
    requestScope: (context: CapabilityContext) => {
      const access = getAccess(context);
      if (!access) throw new CapabilityError('UNAVAILABLE', 'Scene service is unavailable');
      return JSON.stringify([access.principal.ownerId, access.principal.workspaceId]);
    },
  };
  const write = <T>(context: CapabilityContext, fn: (access: SceneAccess) => T): T => {
    const access = getAccess(context);
    if (!access) throw new CapabilityError('UNAVAILABLE', 'Scene service is unavailable');
    if (access.services.application.database !== getSqliteDatabase()) throw new CapabilityError('UNAVAILABLE', 'Scene writes require the operation database');
    try { return fn(access); }
    catch (error) {
      if (error instanceof SceneNotFoundError) throw new CapabilityError('NOT_FOUND', 'Scene not found');
      if (error instanceof SceneConflictError) throw new CapabilityError('REVISION_CONFLICT', error.message);
      if (error instanceof SceneInputError || error instanceof z.ZodError) throw new CapabilityError('INVALID_INPUT', error.message);
      throw error;
    }
  };
  const prepare = async (context: CapabilityContext, fn: (access: SceneAccess) => Promise<void>) => {
    const access = getAccess(context);
    if (!access) throw new CapabilityError('UNAVAILABLE', 'Scene service is unavailable');
    try { await fn(access); }
    catch (error) {
      if (error instanceof SceneSetupError) {
        const failure = new CapabilityError('INVALID_INPUT', error.message);
        failure.cause = error;
        throw failure;
      }
      if (error instanceof SceneNotFoundError) throw new CapabilityError('NOT_FOUND', 'Scene not found');
      if (error instanceof SceneConflictError) throw new CapabilityError('REVISION_CONFLICT', error.message);
      throw error;
    }
  };
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.scenes.start', description: 'Start a scene after authorization and readiness checks, with an atomic durable receipt.', ...SceneWriteContracts['xopc.scenes.start'],
    prepare: (input, context) => prepare(context, async ({ services, principal }) => {
      const result = await services.application.preflight(principal, input);
      if (!result.ready) throw new SceneSetupError(result.missing);
    }),
    execute: (input, context) => write(context, ({ services, principal }) => ({ activation: services.application.startAfterPreflight(principal, input, context.idempotencyKey) })),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.scenes.transition', description: 'Transition a scene at its exact revision, checking readiness before activation.', ...SceneWriteContracts['xopc.scenes.transition'],
    prepare: ({ id, ...input }, context) => prepare(context, ({ services, principal }) => services.application.prepareTransition(principal, id, input)),
    execute: ({ id, ...input }, context) => write(context, ({ services, principal }) => ({ activation: services.application.transitionAfterPreflight(principal, id, input) })),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.scenes.schedule', description: 'Update a scene schedule at its exact revision.', ...SceneWriteContracts['xopc.scenes.schedule'],
    execute: ({ id, triggerKey, ...input }, context) => write(context, ({ services, principal }) => ({ revision: services.application.setSchedule(principal, id, triggerKey, input) })),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.scenes.set_preferences', description: 'Update owner-scoped scene preferences at their exact revision.', ...SceneWriteContracts['xopc.scenes.set_preferences'],
    execute: (input, context) => write(context, ({ services, principal }) => {
      if (services.preferences.database !== getSqliteDatabase()) throw new CapabilityError('UNAVAILABLE', 'Scene preferences require the operation database');
      return services.preferences.update(principal, input);
    }),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.scenes.feedback', description: 'Record an explicit user judgment at the exact feedback revision.', ...SceneWriteContracts['xopc.scenes.feedback'],
    execute: ({ id, ...input }, context) => write(context, ({ services, principal }) => {
      if (services.inbox.database !== getSqliteDatabase()) throw new CapabilityError('UNAVAILABLE', 'Scene feedback requires the operation database');
      return { revision: services.inbox.feedback(principal, id, input) };
    }),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.scenes.mark_read', description: 'Set the read state of an actionable scene presentation once per request.', ...SceneWriteContracts['xopc.scenes.mark_read'],
    execute: ({ id, read }, context) => write(context, ({ services, principal }) => {
      if (services.inbox.database !== getSqliteDatabase()) throw new CapabilityError('UNAVAILABLE', 'Scene presentation requires the operation database');
      services.inbox.setRead(principal, id, read);
      return { ok: true as const, presentationId: id, read };
    }),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.scenes.configure', description: 'Configure a scene at an exact revision and invalidate prior pending work atomically.', ...SceneWriteContracts['xopc.scenes.configure'],
    execute: ({ id, ...input }, context) => write(context, ({ services, principal }) => ({ activation: services.application.configure(principal, id, input) })),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.scenes.check', description: 'Queue a scene check exactly once per request; this does not imply model execution completed.', ...SceneWriteContracts['xopc.scenes.check'],
    execute: ({ id }, context) => write(context, ({ services, principal }) => ({ intentId: services.application.check(principal, id, context.idempotencyKey) })),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.scenes.notes', description: 'Replace scene notes at an exact notes revision, canceling stale work in the same transaction.', ...SceneWriteContracts['xopc.scenes.notes'],
    execute: ({ id, ...input }, context) => write(context, ({ services, principal }) => ({ revision: services.application.writeNotes(principal, id, input) })),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.scenes.work_item', description: 'Create an authorized scene work item with a durable request receipt.', ...SceneWriteContracts['xopc.scenes.work_item'],
    execute: ({ id, ...input }, context) => write(context, ({ services, principal }) => ({ workItem: services.application.createWorkItem(principal, id, input) })),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.scenes.update_work_item', description: 'Edit an authorized scene work item at its exact revision.', ...SceneWriteContracts['xopc.scenes.update_work_item'],
    execute: ({ id, ...input }, context) => write(context, ({ services, principal }) => ({ workItem: services.application.updateWorkItem(principal, id, input) })),
  }));
}
