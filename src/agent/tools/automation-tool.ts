import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { AutomationService } from '../../automations/index.js';
import type { CreateAutomationInput, UpdateAutomationInput } from '../../automations/domain/validation.js';

const AutomationToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal('list'),
    Type.Literal('create'),
    Type.Literal('update'),
    Type.Literal('delete'),
    Type.Literal('run'),
    Type.Literal('pause'),
    Type.Literal('resume'),
    Type.Literal('history'),
  ]),
  automationId: Type.Optional(Type.String({ description: 'Automation id for update/delete/run/pause/resume/history' })),
  automation: Type.Optional(Type.Any({ description: 'Automation create payload' })),
  patch: Type.Optional(Type.Any({ description: 'Automation update patch' })),
  limit: Type.Optional(Type.Number({ description: 'History limit, default 5' })),
});

type AutomationToolInput = {
  action: 'list' | 'create' | 'update' | 'delete' | 'run' | 'pause' | 'resume' | 'history';
  automationId?: string;
  automation?: unknown;
  patch?: unknown;
  limit?: number;
};

export interface AutomationToolDeps {
  getAutomationService: () => AutomationService | undefined;
}

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: 'text' as const, text }], details };
}

function formatAutomation(item: Awaited<ReturnType<AutomationService['list']>>[number]): string {
  const trigger =
    item.trigger.kind === 'schedule'
      ? `${item.trigger.schedule.kind}`
      : item.trigger.kind;
  const status = item.enabled ? 'enabled' : 'paused';
  const next = item.state.nextRunAtMs ? new Date(item.state.nextRunAtMs).toISOString() : 'none';
  return `- ${item.id} · ${item.name} · ${status} · trigger=${trigger} · next=${next}`;
}

export function createAutomationTool(deps: AutomationToolDeps): AgentTool<typeof AutomationToolSchema, Record<string, unknown>> {
  return {
    name: 'automation',
    label: 'Automation',
    description:
      'Manage product automations. Automations can be manual, scheduled, or webhook-triggered and can run an agent instruction or workflow.',
    parameters: AutomationToolSchema,
    async execute(_toolCallId, params: AutomationToolInput) {
      const service = deps.getAutomationService();
      if (!service) {
        return textResult('Automation service is not available.', { ok: false });
      }

      switch (params.action) {
        case 'list': {
          const automations = await service.list();
          const body = automations.length > 0
            ? automations.map(formatAutomation).join('\n')
            : 'No automations.';
          return textResult(body, { automations });
        }
        case 'create': {
          if (!params.automation || typeof params.automation !== 'object') {
            return textResult('automation payload is required for create.', { ok: false });
          }
          const automation = await service.create(params.automation as CreateAutomationInput);
          return textResult(`Created automation ${automation.id}: ${automation.name}`, { automation });
        }
        case 'update': {
          const id = params.automationId?.trim();
          if (!id) return textResult('automationId is required for update.', { ok: false });
          if (!params.patch || typeof params.patch !== 'object') {
            return textResult('patch payload is required for update.', { ok: false });
          }
          const automation = await service.update(id, params.patch as UpdateAutomationInput);
          if (!automation) return textResult(`Automation not found: ${id}`, { ok: false });
          return textResult(`Updated automation ${automation.id}: ${automation.name}`, { automation });
        }
        case 'delete': {
          const id = params.automationId?.trim();
          if (!id) return textResult('automationId is required for delete.', { ok: false });
          const removed = await service.remove(id);
          return textResult(removed ? `Deleted automation ${id}.` : `Automation not found: ${id}`, { removed });
        }
        case 'run': {
          const id = params.automationId?.trim();
          if (!id) return textResult('automationId is required for run.', { ok: false });
          const run = await service.runNow(id);
          return textResult(`Started automation run ${run.id}.`, { run });
        }
        case 'pause': {
          const id = params.automationId?.trim();
          if (!id) return textResult('automationId is required for pause.', { ok: false });
          const automation = await service.pause(id);
          if (!automation) return textResult(`Automation not found: ${id}`, { ok: false });
          return textResult(`Paused automation ${id}.`, { automation });
        }
        case 'resume': {
          const id = params.automationId?.trim();
          if (!id) return textResult('automationId is required for resume.', { ok: false });
          const automation = await service.resume(id);
          if (!automation) return textResult(`Automation not found: ${id}`, { ok: false });
          return textResult(`Resumed automation ${id}.`, { automation });
        }
        case 'history': {
          const id = params.automationId?.trim();
          const runs = await service.listRuns({
            automationId: id || undefined,
            limit: Math.max(1, Math.min(50, Math.floor(params.limit ?? 5))),
          });
          const body = runs.length > 0
            ? runs.map((run) => `- ${run.id} · ${run.automationName} · ${run.status}`).join('\n')
            : 'No automation runs.';
          return textResult(body, { runs });
        }
      }
    },
  };
}
