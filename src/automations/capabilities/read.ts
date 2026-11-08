import { ProductReadContracts } from '@xopcai/gateway-contract';
import { setTimeout as delay } from 'node:timers/promises';

import { CapabilityError, defineReadCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import type { ProjectService } from '../../projects/project-service.js';
import type { AutomationService } from '../service/automation-service.js';
import { automationReadable } from '../../local-apps/capabilities/automation-policy.js';
import { LocalAppAutomationListSchema, LocalAppAutomationOutputSchema, LocalAppAutomationRunOutputSchema } from '../../local-apps/capabilities/projections.js';
import { LocalAppAutomationHistorySchema, LocalAppRunEventsSchema } from '../../local-apps/capabilities/projections.js';
import { projectLocalAppRun } from '../../local-apps/capabilities/projections.js';

export function registerAutomationReadCapabilities(dispatcher: CapabilityDispatcher, service: AutomationService, projects?: ProjectService): void {
  const requireProject = (id?: string) => {
    if (id && !projects?.get(id)) throw new CapabilityError('NOT_FOUND', 'Project not found');
  };
  const policy = { majorVersion: 1, effect: 'read' as const, surfaces: ['http', 'agent', 'cli'] as const, scopes: ['automations.read'] as const };
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.automations.get_run', description: 'Read current run state rather than the historical submission receipt.',
    surfaces: ['http', 'agent', 'cli', 'extension'], extensionOutput: LocalAppAutomationRunOutputSchema,
    ...ProductReadContracts['xopc.automations.get_run'],
    async execute({ id, waitMs }, context) {
      const deadline = Date.now() + (context.localApp ? Math.min(waitMs ?? 0, 5000) : waitMs ?? 0);
      for (;;) {
        context.assertCurrent?.();
        context.signal?.throwIfAborted();
        const run = await service.getRun(id);
        if (!run) throw new CapabilityError('NOT_FOUND', 'Run not found');
        const remaining = deadline - Date.now();
        if (!['queued', 'running', 'cancelling'].includes(run.status) || remaining <= 0) return { ok: true as const,
          run: { ...(context.localApp ? projectLocalAppRun(run) : run) } };
        await delay(Math.min(250, remaining), undefined, { signal: context.signal });
      }
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.automations.run_events', description: 'Read ordered diagnostic events for an existing run.',
    surfaces: ['http', 'agent', 'cli', 'extension'], extensionOutput: LocalAppRunEventsSchema,
    ...ProductReadContracts['xopc.automations.run_events'],
    async execute({ id }, context) {
      if (!await service.getRun(id)) throw new CapabilityError('NOT_FOUND', 'Run not found');
      const events = await service.listRunEvents(id);
      return { ok: true as const, events: (context.localApp ? events.slice(-100) : events).map(event => ({ ...event })), truncated: context.localApp ? events.length > 100 : false };
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
    surfaces: ['http', 'agent', 'cli', 'extension'], extensionOutput: LocalAppAutomationListSchema,
    ...ProductReadContracts['xopc.automations.list'],
    async extensionExecute(input, context) {
      const items = await service.list(input);
      return { ok: true, items: items.filter(item => context.localApp && automationReadable(context.localApp.resourceScopes, item)) };
    },
    async execute(input) {
      requireProject(input.projectId);
      return { ok: true as const, items: (await service.list(input)).map(item => ({ ...item })), projectId: input.projectId, executionSummaries: service.executionSummaries(input.projectId) };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.automations.get', description: 'Read an automation.',
    surfaces: ['http', 'agent', 'cli', 'extension'], extensionOutput: LocalAppAutomationOutputSchema,
    ...ProductReadContracts['xopc.automations.get'],
    async execute({ id }) {
      const automation = await service.get(id);
      if (!automation) throw new CapabilityError('NOT_FOUND', 'Automation not found');
      return { ok: true as const, automation: { ...automation } };
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.automations.history', description: 'Read automation execution history.',
    surfaces: ['http', 'agent', 'cli', 'extension'], extensionOutput: LocalAppAutomationHistorySchema,
    ...ProductReadContracts['xopc.automations.history'],
    async execute(input, context) {
      if (!context.localApp) requireProject(input.projectId);
      let before: { createdAtMs: number; id: string } | undefined;
      if (input.cursor) {
        try {
          const parsed = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
          if (!Number.isSafeInteger(parsed.createdAtMs) || parsed.createdAtMs < 0 || typeof parsed.id !== 'string' || !parsed.id
            || parsed.automationId !== input.automationId || parsed.projectId !== input.projectId) throw new Error('Invalid cursor');
          before = { createdAtMs: parsed.createdAtMs, id: parsed.id };
        } catch { throw new CapabilityError('INVALID_INPUT', 'Invalid history cursor for this scope'); }
      }
      const rows = await service.listRuns({ ...input, before, limit: input.limit + 1,
        ...(context.localApp ? { localAppRestriction: { extensionId: context.localApp.extensionId, scope: context.localApp.resourceScopes.automationsRead } } : {}) });
      const hasMore = rows.length > input.limit;
      const items = rows.slice(0, input.limit).map(item => ({ ...(context.localApp ? projectLocalAppRun(item) : item) }));
      const last = items.at(-1);
      const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ createdAtMs: last.createdAtMs, id: last.id,
        automationId: input.automationId, projectId: input.projectId })).toString('base64url') : undefined;
      return { ok: true as const, items, projectId: input.projectId, hasMore, nextCursor };
    },
  }));
}
