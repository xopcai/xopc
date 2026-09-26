import { ProductReadContracts } from '@xopcai/gateway-contract';

import { CapabilityError, defineReadCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import type { ProjectService } from '../../projects/project-service.js';
import type { AutomationService } from '../service/automation-service.js';

export function registerAutomationReadCapabilities(dispatcher: CapabilityDispatcher, service: AutomationService, projects?: ProjectService): void {
  const requireProject = (id?: string) => {
    if (id && !projects?.get(id)) throw new CapabilityError('NOT_FOUND', 'Project not found');
  };
  const policy = { majorVersion: 1, effect: 'read' as const, surfaces: ['http', 'agent', 'cli'] as const, scopes: ['automations.read'] as const };
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.automations.get_run', description: 'Read current run state rather than the historical submission receipt.',
    ...ProductReadContracts['xopc.automations.get_run'],
    async execute({ id }) {
      const run = await service.getRun(id);
      if (!run) throw new CapabilityError('NOT_FOUND', 'Run not found');
      return { ok: true as const, run: { ...run } };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.automations.run_events', description: 'Read ordered diagnostic events for an existing run.',
    ...ProductReadContracts['xopc.automations.run_events'],
    async execute({ id }) {
      if (!await service.getRun(id)) throw new CapabilityError('NOT_FOUND', 'Run not found');
      return { ok: true as const, events: (await service.listRunEvents(id)).map(event => ({ ...event })) };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.automations.metrics', description: 'Read automation scheduling and local runtime metrics.',
    ...ProductReadContracts['xopc.automations.metrics'],
    async execute() { return { ok: true as const, metrics: await service.getMetrics() }; },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.automations.events', description: 'Inspect durable trigger events and per-automation delivery state.',
    ...ProductReadContracts['xopc.automations.events'],
    execute(input) { return { ok: true as const, items: service.listEventRecords(input) }; },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.automations.deliveries', description: 'Inspect durable automation result delivery state.',
    ...ProductReadContracts['xopc.automations.deliveries'],
    execute(input) { return { ok: true as const, items: service.listResultDeliveries(input) }; },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.automations.product_events', description: 'Find runs by their original product trigger event.',
    ...ProductReadContracts['xopc.automations.product_events'],
    async execute(input) {
      return { ok: true as const, items: (await service.listRunsForProductEvent(input)).map(item => ({ run: { ...item.run }, triggerEvent: { ...item.triggerEvent } })) };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.automations.list', description: 'List automations, optionally scoped to a project.',
    ...ProductReadContracts['xopc.automations.list'],
    async execute(input) {
      requireProject(input.projectId);
      return { ok: true as const, items: (await service.list(input)).map(item => ({ ...item })), projectId: input.projectId };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.automations.get', description: 'Read an automation.',
    ...ProductReadContracts['xopc.automations.get'],
    async execute({ id }) {
      const automation = await service.get(id);
      if (!automation) throw new CapabilityError('NOT_FOUND', 'Automation not found');
      return { ok: true as const, automation: { ...automation } };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.automations.history', description: 'Read automation execution history.',
    ...ProductReadContracts['xopc.automations.history'],
    async execute(input) {
      requireProject(input.projectId);
      return { ok: true as const, items: (await service.listRuns(input)).map(item => ({ ...item })), projectId: input.projectId };
    },
  }));
}
