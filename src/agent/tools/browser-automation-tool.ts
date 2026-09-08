import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from '@sinclair/typebox';

import type { BrowserAutomationService } from '../../browser/automations/index.js';

const ExpectationSchema = Type.Object({
  urlIncludes: Type.Optional(Type.String()),
  titleIncludes: Type.Optional(Type.String()),
  textIncludes: Type.Optional(Type.String()),
  ref: Type.Optional(Type.String()),
  state: Type.Optional(Type.Union([Type.Literal('visible'), Type.Literal('hidden')])),
}, { additionalProperties: false });

const TargetSchema = Type.Object({
  role: Type.String(),
  name: Type.Optional(Type.String()),
  nameIncludes: Type.Optional(Type.String()),
}, { additionalProperties: false });

const StepSchema = Type.Union([
  Type.Object({ action: Type.Literal('navigate'), url: Type.String(), expect: Type.Optional(ExpectationSchema) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('click'), target: TargetSchema, expect: Type.Optional(ExpectationSchema) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('fill'), target: TargetSchema, value: Type.String(), submit: Type.Optional(Type.Boolean()), expect: Type.Optional(ExpectationSchema) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('select'), target: TargetSchema, value: Type.String(), expect: Type.Optional(ExpectationSchema) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('press'), target: Type.Optional(TargetSchema), key: Type.String(), expect: Type.Optional(ExpectationSchema) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('scroll'), target: Type.Optional(TargetSchema), deltaY: Type.Number(), expect: Type.Optional(ExpectationSchema) }, { additionalProperties: false }),
  Type.Object({
    action: Type.Literal('wait'),
    condition: Type.Union([Type.Literal('page_idle'), Type.Literal('text'), Type.Literal('visible'), Type.Literal('hidden')]),
    value: Type.Optional(Type.String()), target: Type.Optional(TargetSchema), timeoutMs: Type.Optional(Type.Integer()),
  }, { additionalProperties: false }),
]);

const BrowserAutomationToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal('list'), Type.Literal('get'), Type.Literal('save'), Type.Literal('enable'),
    Type.Literal('disable'), Type.Literal('delete'), Type.Literal('run'),
  ]),
  automationId: Type.Optional(Type.String()),
  definition: Type.Optional(Type.Object({
    id: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    allowedDomains: Type.Array(Type.String()),
    risk: Type.Union([Type.Literal('read'), Type.Literal('draft'), Type.Literal('external_effect'), Type.Literal('destructive'), Type.Literal('sensitive')]),
    inputs: Type.Record(Type.String(), Type.Object({
      type: Type.Union([Type.Literal('string'), Type.Literal('number'), Type.Literal('boolean')]),
      required: Type.Optional(Type.Boolean()),
      default: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
      description: Type.Optional(Type.String()),
      choices: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean()]))),
    }, { additionalProperties: false })),
    steps: Type.Array(StepSchema),
  }, { additionalProperties: false })),
  inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: false });

type BrowserAutomationToolInput = Static<typeof BrowserAutomationToolSchema>;

export function createBrowserAutomationTool(deps: {
  getBrowserAutomationService: () => BrowserAutomationService | undefined;
}): AgentTool<typeof BrowserAutomationToolSchema, Record<string, unknown>> {
  return {
    name: 'browser_automation',
    label: 'Browser Automation',
    description: 'Create and run strict JSON browser automations. Saved steps use semantic role/name targets and exact allowed domains; CSS, XPath, JavaScript, cookies, and network access are not supported.',
    parameters: BrowserAutomationToolSchema,
    async execute(_toolCallId, params: BrowserAutomationToolInput, signal) {
      const service = deps.getBrowserAutomationService();
      if (!service) return output('Browser automation is unavailable.', { ok: false });
      if (params.action === 'list') {
        const automations = service.list();
        return output(automations.length ? automations.map((item) => `- ${item.id}: ${item.definition.name} (${item.status}, ${item.definition.risk})`).join('\n') : 'No browser automations.', { ok: true, automations });
      }
      if (params.action === 'save') {
        if (!params.definition) return output('definition is required.', { ok: false });
        try {
          const automation = service.save({ definition: params.definition });
          return output(`Saved browser automation: ${automation.definition.name}`, { ok: true, automation });
        } catch (error) {
          return output(`Could not save browser automation: ${message(error)}`, { ok: false, error: message(error) });
        }
      }
      const id = params.automationId?.trim();
      if (!id) return output('automationId is required.', { ok: false });
      const current = service.get(id);
      if (params.action === 'get') return current ? output(JSON.stringify(current.definition, null, 2), { ok: true, automation: current }) : output(`Browser automation not found: ${id}`, { ok: false });
      if (params.action === 'enable' || params.action === 'disable') {
        if (!current) return output(`Browser automation not found: ${id}`, { ok: false });
        const automation = service.save({ definition: current.definition, expectedId: id, status: params.action === 'enable' ? 'enabled' : 'disabled' });
        return output(`${automation.definition.name} is ${automation.status}.`, { ok: true, automation });
      }
      if (params.action === 'delete') {
        try { const removed = service.remove(id); return output(removed ? `Deleted browser automation: ${id}` : `Browser automation not found: ${id}`, { ok: removed }); }
        catch (error) { return output(`Could not delete browser automation: ${message(error)}`, { ok: false, error: message(error) }); }
      }
      try {
        const run = await service.runAndWait(id, params.inputs ?? {}, signal);
        return output(run.status === 'succeeded' ? `Browser automation ${id} completed.` : `Browser automation ${id} ${run.status}: ${run.error ?? 'No details'}`, { ok: run.status === 'succeeded', run });
      } catch (error) {
        return output(`Browser automation failed: ${message(error)}`, { ok: false, error: message(error) });
      }
    },
  };
}

function output(text: string, details: Record<string, unknown>) { return { content: [{ type: 'text' as const, text }], details }; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
