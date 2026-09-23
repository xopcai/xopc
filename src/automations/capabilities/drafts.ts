import { z } from 'zod';
import { AutomationSimulationSchema as simulationSchema, AutomationDraftRequestSchema as requestSchema,
  AutomationDraftOutputSchema as draftSchema, AutomationRepairDraftOutputSchema as repairSchema } from '@xopcai/gateway-contract';

import { resolveDefaultAgentId } from '../../agent/agent-scope.js';
import { CapabilityError, defineExternalCapability, defineReadCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { ExternalEffectNotAppliedError } from '../../capabilities/runtime/external-operations.js';
import type { Config } from '../../config/schema.js';
import { getUserTrustPolicy } from '../../storage/sqlite/index.js';
import { resolveAutomationSafetyForTrust } from '../../user-context/trust-policy.js';
import { AutomationDraftService, simulateAutomation } from '../draft/index.js';
import type { AutomationService } from '../service/automation-service.js';
import { AutomationCreateCapabilityInputSchema } from './write.js';

export function registerAutomationDraftCapabilities(dispatcher: CapabilityDispatcher, service: AutomationService, getConfig?: () => Config | undefined): void {
  const policy = { majorVersion: 1, effect: 'external-write' as const, recovery: 'manual' as const,
    surfaces: ['http', 'agent'] as const, scopes: ['automations.write'] as const };
  const configuration = () => {
    const config = getConfig?.();
    if (!config) throw new ExternalEffectNotAppliedError('Automation draft configuration is unavailable');
    return config;
  };
  dispatcher.register(defineReadCapability({
    id: 'xopc.automations.simulate', majorVersion: 1, effect: 'read', surfaces: ['http', 'agent'], scopes: ['automations.read'],
    description: 'Validate and explain an automation without running it or calling a model.',
    input: AutomationCreateCapabilityInputSchema, output: z.object({ simulation: simulationSchema }),
    execute(input) {
      try { return { simulation: simulateAutomation(input) }; }
      catch (error) { throw new CapabilityError('INVALID_INPUT', error instanceof Error ? error.message : 'Invalid automation'); }
    },
  }));
  dispatcher.register(defineExternalCapability({
    ...policy, id: 'xopc.automations.draft', description: 'Generate an automation draft with a durable receipt; does not install or run the automation.',
    input: requestSchema.extend({ prompt: z.string().trim().min(1).max(50000) }), output: z.object({ draft: draftSchema }),
    async execute(input, context) {
      const config = configuration();
      const draft = await new AutomationDraftService({ config }).createDraft({ ...input, agentId: input.agentId ?? resolveDefaultAgentId() }, context.signal);
      draft.automation.safety = { mode: resolveAutomationSafetyForTrust(getUserTrustPolicy().defaultActionLevel, draft.automation.safety?.mode) };
      draft.simulation = simulateAutomation(draft.automation);
      return { draft: JSON.parse(JSON.stringify(draft)) as z.input<typeof draftSchema> };
    },
  }));
  dispatcher.register(defineExternalCapability({
    ...policy, id: 'xopc.automations.repair_draft', description: 'Generate, but do not apply, a repair for a failed automation run.',
    input: requestSchema.extend({ id: z.string().min(1).max(512) }), output: z.object({ repair: repairSchema }),
    async execute({ id, agentId, language }, context) {
      const config = configuration();
      const run = await service.getRun(id);
      if (!run) throw new ExternalEffectNotAppliedError('Run not found', { cause: new CapabilityError('NOT_FOUND', 'Run not found') });
      if (!['failed', 'timeout', 'cancelled'].includes(run.status)) throw new ExternalEffectNotAppliedError('Invalid repair state', {
        cause: new CapabilityError('INVALID_INPUT', 'Repair requires a failed, timed out, or cancelled run'),
      });
      const automation = await service.get(run.automationId);
      if (!automation) throw new ExternalEffectNotAppliedError('Automation not found', { cause: new CapabilityError('NOT_FOUND', 'Automation not found') });
      const events = await service.listRunEvents(id);
      const repair = await new AutomationDraftService({ config }).createRepairDraft({
        agentId: agentId ?? resolveDefaultAgentId(), automation, run, events, language,
      }, context.signal);
      return { repair: JSON.parse(JSON.stringify(repair)) as z.input<typeof repairSchema> };
    },
  }));
}
