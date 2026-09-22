import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import {
  appendProductDeliveryText,
  AutomationMutationOutputSchema,
  AutomationRunMutationOutputSchema,
  AutomationCancelOutputSchema,
  AutomationReadOutputSchema,
  AutomationReadAllOutputSchema,
  AutomationDeleteOutputSchema,
  ProductReadContracts,
  type Automation as AutomationDto,
  type ProductDeliveryEnvelope,
} from '@xopcai/gateway-contract';

import type { Automation, AutomationService } from '../../automations/index.js';
import type { ProjectService } from '../../projects/project-service.js';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import type { CapabilityContext } from '../../capabilities/runtime/dispatcher.js';

const AutomationToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal('list'),
    Type.Literal('create'),
    Type.Literal('update'),
    Type.Literal('delete'),
    Type.Literal('run'),
    Type.Literal('rerun'),
    Type.Literal('cancel'),
    Type.Literal('read'),
    Type.Literal('read_all'),
    Type.Literal('pause'),
    Type.Literal('resume'),
    Type.Literal('history'),
    Type.Literal('get_run'),
    Type.Literal('run_events'),
    Type.Literal('metrics'),
    Type.Literal('product_events'),
  ]),
  automationId: Type.Optional(Type.String({ description: 'Automation id for update/delete/run/pause/resume/history' })),
  runId: Type.Optional(Type.String({ description: 'Run id for rerun/cancel/read' })),
  projectId: Type.Optional(Type.String({ description: 'Optional project filter for read_all; omitted means all projects' })),
  automation: Type.Optional(Type.Any({ description: 'Automation create payload' })),
  patch: Type.Optional(Type.Any({ description: 'Automation update patch' })),
  limit: Type.Optional(Type.Number({ description: 'History limit, default 5' })),
  eventType: Type.Optional(Type.String()),
  source: Type.Optional(Type.String()),
  payloadKey: Type.Optional(Type.String()),
  payloadValue: Type.Optional(Type.String()),
  expectedRevision: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], { description: 'Original updatedAtMs for edits/deletion; null only means deletion expects an absent object' })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: 'Stable write retry key, including cancel/read/read_all; only edits and deletion require expectedRevision' })),
});

type AutomationToolInput = {
  action: 'list' | 'create' | 'update' | 'delete' | 'run' | 'rerun' | 'cancel' | 'read' | 'read_all' | 'pause' | 'resume' | 'history' | 'get_run' | 'run_events' | 'metrics' | 'product_events';
  eventType?: string;
  source?: string;
  payloadKey?: string;
  payloadValue?: string;
  runId?: string;
  projectId?: string;
  automationId?: string;
  automation?: unknown;
  patch?: unknown;
  limit?: number;
  expectedRevision?: number | null;
  idempotencyKey?: string;
};

export interface AutomationToolDeps {
  getAutomationService: () => AutomationService | undefined;
  getCurrentAgentId?: () => string | undefined;
  getProjectService?: () => ProjectService | undefined;
}

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{
      type: 'text' as const,
      text: appendProductDeliveryText(
        text,
        details.delivery as ProductDeliveryEnvelope | undefined,
      ),
    }],
    details,
  };
}

function formatAutomation(item: AutomationDto): string {
  const trigger =
    item.trigger.kind === 'schedule'
      ? `${item.trigger.schedule?.kind ?? 'schedule'}`
      : item.trigger.kind;
  const status = item.enabled ? 'enabled' : 'paused';
  const next = item.state.nextRunAtMs ? new Date(item.state.nextRunAtMs).toISOString() : 'none';
  return `- ${item.id} · ${item.name} · ${status} · trigger=${trigger} · next=${next}`;
}

function automationDelivery(
  automation: Pick<Automation, 'id' | 'name' | 'description' | 'enabled' | 'updatedAtMs' | 'projectId'>,
  operation: 'created' | 'updated' | 'started',
): ProductDeliveryEnvelope {
  return {
    version: 1,
    operation,
    primary: {
      kind: 'automation',
      id: automation.id,
      title: automation.name,
      summary: automation.description?.trim() || undefined,
      status: automation.enabled ? 'enabled' : 'paused',
      revision: String(automation.updatedAtMs),
      projectId: automation.projectId ?? undefined,
      capabilities: [
        'open',
        'edit',
        'continue_in_chat',
        'run',
        automation.enabled ? 'pause' : 'resume',
      ],
    },
  };
}

export function createAutomationTool(deps: AutomationToolDeps): AgentTool<typeof AutomationToolSchema, Record<string, unknown>> {
  return {
    name: 'automation',
    label: 'Automation',
    description:
      'Manage product automations. Automations can be manual, scheduled, webhook-triggered, or product-event-triggered and can run an agent instruction or workflow.',
    parameters: AutomationToolSchema,
    async execute(_toolCallId, params: AutomationToolInput, signal) {
      const service = deps.getAutomationService();
      if (!service) {
        return textResult('Automation service is not available.', { ok: false });
      }
      const call = async (operation: string, input: unknown, scope: 'automations.read' | 'automations.write' = 'automations.write') => {
        const capabilities = createProductDispatcher(undefined, { getAutomations: () => service, getProjects: deps.getProjectService });
        const caller: CapabilityContext = { principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent', scopes: [scope], authorize: () => true, signal };
        return capabilities.call(operation, input, caller,
          { ...capabilities.describe(operation, caller), idempotencyKey: params.idempotencyKey ?? randomUUID() });
      };
      const invoke = async (operation: string, input: unknown) => AutomationMutationOutputSchema.parse(await call(operation, input));

      switch (params.action) {
        case 'list': {
          const { items: automations } = ProductReadContracts['xopc.automations.list'].output.parse(await call('xopc.automations.list', { projectId: params.projectId }, 'automations.read'));
          const body = automations.length > 0
            ? automations.map(formatAutomation).join('\n')
            : 'No automations.';
          return textResult(body, { automations });
        }
        case 'create': {
          if (!params.automation || typeof params.automation !== 'object') {
            return textResult('automation payload is required for create.', { ok: false });
          }
          const { automation } = await invoke('xopc.automations.create', params.automation);
          return textResult(`Created automation ${automation.id}: ${automation.name}`, {
            automation,
            delivery: automationDelivery(automation, 'created'),
          });
        }
        case 'update': {
          const id = params.automationId?.trim();
          if (!id) return textResult('automationId is required for update.', { ok: false });
          if (!params.patch || typeof params.patch !== 'object') {
            return textResult('patch payload is required for update.', { ok: false });
          }
          if (params.idempotencyKey !== undefined && params.expectedRevision === undefined) {
            return textResult('Idempotent automation changes require expectedRevision from the original read.', { ok: false });
          }
          const expectedRevision = params.expectedRevision !== undefined ? params.expectedRevision : (await service.get(id))?.updatedAtMs;
          if (expectedRevision === undefined) return textResult(`Automation not found: ${id}`, { ok: false });
          const { automation } = await invoke('xopc.automations.update', { id, patch: params.patch, expectedRevision });
          return textResult(`Updated automation ${automation.id}: ${automation.name}`, {
            automation,
            delivery: automationDelivery(automation, 'updated'),
          });
        }
        case 'delete': {
          const id = params.automationId?.trim();
          if (!id) return textResult('automationId is required for delete.', { ok: false });
          if (params.idempotencyKey !== undefined && params.expectedRevision === undefined) {
            return textResult('Idempotent deletion requires the original expectedRevision.', { ok: false });
          }
          const expectedRevision = params.expectedRevision !== undefined ? params.expectedRevision : (await service.get(id))?.updatedAtMs ?? null;
          const { removed } = AutomationDeleteOutputSchema.parse(await call('xopc.automations.delete', { id, expectedRevision }));
          return textResult(removed ? `Deleted automation ${id}.` : `Automation not found: ${id}`, { removed });
        }
        case 'cancel': {
          const result = AutomationCancelOutputSchema.parse(await call('xopc.automations.cancel', { id: params.runId }));
          return textResult(result.cancelled ? (result.confirmed ? 'Queued run cancelled.' : 'Cancellation requested; stopping is not yet confirmed.') : 'No active run to cancel.', result);
        }
        case 'read': {
          const result = AutomationReadOutputSchema.parse(await call('xopc.automations.read', { id: params.runId }));
          return textResult('Run marked read.', result);
        }
        case 'read_all': {
          const result = AutomationReadAllOutputSchema.parse(await call('xopc.automations.read_all', { projectId: params.projectId }));
          return textResult(`Marked ${result.count} completed runs read.`, result);
        }
        case 'run':
        case 'rerun': {
          const id = params.action === 'run' ? params.automationId?.trim() : params.runId?.trim();
          if (!id) return textResult('An automation id for run or source run id for rerun is required.', { ok: false });
          const { automation, run } = AutomationRunMutationOutputSchema.parse(await call(`xopc.automations.${params.action}`, { id }));
          return textResult(`Queued automation run ${run.id}.`, {
            run,
            ...(automation ? { delivery: automationDelivery(automation, 'started') } : {}),
          });
        }
        case 'pause':
        case 'resume': {
          const id = params.automationId?.trim();
          if (!id) return textResult(`automationId is required for ${params.action}.`, { ok: false });
          if (params.idempotencyKey !== undefined && params.expectedRevision === undefined) {
            return textResult('Idempotent automation changes require expectedRevision from the original read.', { ok: false });
          }
          const expectedRevision = params.expectedRevision !== undefined ? params.expectedRevision : (await service.get(id))?.updatedAtMs;
          if (expectedRevision === undefined) return textResult(`Automation not found: ${id}`, { ok: false });
          const { automation } = await invoke('xopc.automations.set_enabled', { id, enabled: params.action === 'resume', expectedRevision });
          return textResult(`${params.action === 'pause' ? 'Paused' : 'Resumed'} automation ${id}.`, {
            automation,
            delivery: automationDelivery(automation, 'updated'),
          });
        }
        case 'history': {
          const id = params.automationId?.trim();
          const { items: runs } = ProductReadContracts['xopc.automations.history'].output.parse(await call('xopc.automations.history', {
            automationId: id || undefined,
            projectId: id ? undefined : params.projectId,
            limit: params.limit ?? 5,
          }, 'automations.read'));
          const body = runs.length > 0
            ? runs.map((run) => `- ${run.id} · ${run.automationName} · ${run.status}`).join('\n')
            : 'No automation runs.';
          return textResult(body, { runs });
        }
        case 'get_run':
        case 'run_events':
        case 'metrics':
        case 'product_events': {
          const operation = `xopc.automations.${params.action}` as const;
          const input = params.action === 'metrics' ? {} : params.action === 'product_events'
            ? { eventType: params.eventType, source: params.source, payloadKey: params.payloadKey, payloadValue: params.payloadValue, limit: params.limit }
            : { id: params.runId };
          const result = ProductReadContracts[operation].output.parse(await call(operation, input, 'automations.read'));
          return textResult(JSON.stringify(result), result);
        }
      }
    },
  };
}
