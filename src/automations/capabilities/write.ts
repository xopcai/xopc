import { AutomationCancelOutputSchema, AutomationReadOutputSchema, AutomationReadAllInputSchema, AutomationReadAllOutputSchema, AutomationDeleteInputSchema, AutomationDeleteOutputSchema, AutomationMutationOutputSchema, AutomationRunMutationOutputSchema, AutomationSetEnabledInputSchema, CapabilityResourceInputSchema } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { CapabilityError, defineAtomicCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { getAutomation, getAutomationRun, markAutomationRunRead, markAllAutomationRunsRead } from '../storage/index.js';
import { AutomationAlreadyExistsError, AutomationAlreadyRunningError, type AutomationService } from '../service/automation-service.js';
import { CreateAutomationSchema, UpdateAutomationSchema } from '../domain/validation.js';
import type { ProjectService } from '../../projects/project-service.js';

export const AutomationCreateCapabilityInputSchema = CreateAutomationSchema.omit({ state: true });
export const AutomationUpdatePatchSchema = UpdateAutomationSchema.safeExtend({ state: z.never().optional() });

export function registerAutomationWriteCapabilities(dispatcher: CapabilityDispatcher, service: AutomationService, projects?: ProjectService): void {
  const policy = { majorVersion: 1, effect: 'local-write' as const, surfaces: ['http', 'agent'] as const,
    scopes: ['automations.write'] as const, output: AutomationMutationOutputSchema,
    afterCommit: () => service.refreshSchedule() };
  const requireProject = (id?: string) => {
    if (id && !projects?.get(id)) throw new CapabilityError('NOT_FOUND', 'Project not found');
  };
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.automations.cancel',
    description: 'Persist cancellation intent for a run. Only queued work is confirmed stopped immediately; receipts describe acceptance time.',
    input: CapabilityResourceInputSchema, output: AutomationCancelOutputSchema,
    execute: ({ id }) => ({ ok: true as const, ...service.cancelRunAtomically(id) }),
    afterCommit: (result, { id }) => { if (result.cancelled) service.dispatchCancellation(id); },
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.automations.read', description: 'Mark a completed run read, preserving its first read timestamp.',
    input: CapabilityResourceInputSchema, output: AutomationReadOutputSchema,
    execute({ id }) {
      if (!markAutomationRunRead(id)) throw new CapabilityError('NOT_FOUND', 'Completed run not found');
      return { ok: true as const, marked: true as const };
    },
    afterCommit: undefined,
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.automations.read_all', description: 'Mark currently completed runs read; replay never includes runs completed later.',
    input: AutomationReadAllInputSchema, output: AutomationReadAllOutputSchema,
    execute: input => ({ ok: true as const, count: markAllAutomationRunsRead(input) }),
    afterCommit: undefined,
  }));
  for (const command of ['run', 'rerun'] as const) {
    dispatcher.register(defineAtomicCapability({
      ...policy, id: `xopc.automations.${command}`,
      description: command === 'run' ? 'Queue a manual run with the currently accepted execution configuration.' : 'Queue a rerun with current configuration and the original trigger event.',
      input: CapabilityResourceInputSchema, output: AutomationRunMutationOutputSchema,
      execute({ id }) {
        const automationId = command === 'run' ? id : getAutomationRun(id)?.automationId;
        const automation = automationId ? getAutomation(automationId) : null;
        if (!automation) throw new CapabilityError('NOT_FOUND', 'Automation or source run not found');
        try {
          const run = command === 'run' ? service.queueRunAtomically(id) : service.queueRerunAtomically(id);
          return { ok: true as const, automation: { ...automation }, run: { ...run } };
        } catch (error) {
          if (error instanceof AutomationAlreadyRunningError) throw new CapabilityError('IN_PROGRESS', error.message);
          throw error;
        }
      },
      afterCommit: result => service.dispatchQueuedRun(result.run.id),
    }));
  }
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.automations.delete', description: 'Delete an automation at an exact revision and persist cancellation intent for its active run.',
    input: AutomationDeleteInputSchema, output: AutomationDeleteOutputSchema,
    execute({ id, expectedRevision }) {
      const current = getAutomation(id);
      if (current && current.updatedAtMs !== expectedRevision) throw new CapabilityError('REVISION_CONFLICT', 'Automation changed');
      const result = service.removeAtomically(id);
      return { ok: true as const, ...result, automation: result.automation ? { ...result.automation } : undefined };
    },
    afterCommit: result => service.finishRemoval(result.cancelRunId),
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.automations.create', description: 'Create an automation without replacing an existing identity.',
    input: AutomationCreateCapabilityInputSchema,
    execute(input) {
      requireProject(input.projectId);
      try { return { ok: true as const, automation: { ...service.createAtomically(input) } }; }
      catch (error) {
        if (error instanceof AutomationAlreadyExistsError) throw new CapabilityError('REVISION_CONFLICT', error.message);
        throw error;
      }
    },
  }));
  dispatcher.register(defineAtomicCapability({
    ...policy, id: 'xopc.automations.update', description: 'Edit automation configuration at an exact revision.',
    input: z.strictObject({ id: z.string().trim().min(1).max(100), expectedRevision: z.number().int().nonnegative(),
      patch: AutomationUpdatePatchSchema }),
    execute({ id, expectedRevision, patch }) {
      const current = getAutomation(id);
      if (!current) throw new CapabilityError('NOT_FOUND', 'Automation not found');
      if (current.updatedAtMs !== expectedRevision) throw new CapabilityError('REVISION_CONFLICT', 'Automation changed');
      requireProject(patch.projectId);
      return { ok: true as const, automation: { ...service.updateAtomically(id, patch)! } };
    },
  }));
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.automations.set_enabled', majorVersion: 1,
    description: 'Pause or resume future automation scheduling at an exact revision; does not cancel an active run.',
    effect: 'local-write', surfaces: ['http', 'agent'], scopes: ['automations.write'],
    input: AutomationSetEnabledInputSchema, output: AutomationMutationOutputSchema,
    execute({ id, enabled, expectedRevision }) {
      const current = getAutomation(id);
      if (!current) throw new CapabilityError('NOT_FOUND', 'Automation not found');
      if (current.updatedAtMs !== expectedRevision) throw new CapabilityError('REVISION_CONFLICT', 'Automation changed');
      const automation = service.updateAtomically(id, { enabled });
      if (!automation) throw new CapabilityError('NOT_FOUND', 'Automation not found');
      return { ok: true as const, automation: { ...automation } };
    },
    afterCommit: () => service.refreshSchedule(),
  }));
}
