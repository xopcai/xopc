import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from '@sinclair/typebox';
import {
  appendProductDeliveryText,
  PRODUCT_DELIVERY_VERSION,
  type ProductDeliveryEnvelope,
} from '@xopcai/gateway-contract';

import type { Automation, AutomationNotificationPolicy, AutomationSchedule, AutomationService } from '../../automations/index.js';
import type { Config } from '../../config/schema.js';
import { AutomationScheduleSchema } from '../../automations/domain/validation.js';
import { getAutomation } from '../../automations/storage/index.js';
import { getPersonalAgentByConversation } from '../../personal-agent/repository.js';
import { isPersonalSchedule, personalScheduleInput } from '../../personal-agent/schedules.js';
import { resolveResponseLanguageForSession } from '../prompt/response-language.js';
import { runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';

const PersonalScheduleInputSchema = Type.Object({
  kind: Type.Union([Type.Literal('once'), Type.Literal('interval'), Type.Literal('cron')]),
  at: Type.Optional(Type.String({ description: 'ISO-8601 timestamp for kind="once".' })),
  afterMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 366 * 86_400_000, description: 'Relative delay in milliseconds from now for kind="once".' })),
  everyMs: Type.Optional(Type.Integer({ minimum: 60_000, description: 'Interval in milliseconds for kind="interval".' })),
  anchorMs: Type.Optional(Type.Integer({ minimum: 0, description: 'Optional epoch ms anchor for kind="interval".' })),
  expr: Type.Optional(Type.String({ minLength: 1, description: '5-field cron expression for kind="cron", e.g. "0 9 * * *".' })),
  tz: Type.Optional(Type.String({ maxLength: 100, description: 'Explicit IANA timezone for kind="cron", e.g. "Asia/Shanghai".' })),
}, { additionalProperties: false });

const PersonalScheduleToolSchema = Type.Object({
  command: Type.Union([
    Type.Literal('list'),
    Type.Literal('get'),
    Type.Literal('create'),
    Type.Literal('update'),
    Type.Literal('pause'),
    Type.Literal('resume'),
    Type.Literal('delete'),
    Type.Literal('run'),
  ]),
  scheduleId: Type.Optional(Type.String({ minLength: 1, maxLength: 100, description: 'Schedule ID for get/update/pause/resume/delete/run.' })),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 100, description: 'Short descriptive schedule name.' })),
  description: Type.Optional(Type.String({ maxLength: 500, description: 'Optional short summary.' })),
  instruction: Type.Optional(Type.String({ minLength: 1, maxLength: 50_000, description: 'Full task instruction executed on each scheduled run.' })),
  locale: Type.Optional(Type.Union([Type.Literal('zh'), Type.Literal('en')])),
  schedule: Type.Optional(PersonalScheduleInputSchema),
  enabled: Type.Optional(Type.Boolean()),
  notificationPolicy: Type.Optional(Type.Union([
    Type.Literal('all'),
    Type.Literal('attention'),
    Type.Literal('none'),
  ], { description: 'Use "all" for expected reminders/reports; "attention" for exceptional updates; "none" for silent.' })),
  expectedRevision: Type.Optional(Type.Integer({ minimum: 0, description: 'Original updatedAtMs from list/get for optimistic concurrency.' })),
}, { additionalProperties: false });

type PersonalScheduleToolInput = Static<typeof PersonalScheduleToolSchema>;

export interface PersonalScheduleToolDeps {
  getAutomationService: () => AutomationService | undefined;
  getCurrentConversationId: () => string | undefined;
  getConfig?: () => Config | undefined;
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

function scheduleDelivery(
  automation: Pick<Automation, 'id' | 'name' | 'description' | 'enabled' | 'updatedAtMs'>,
  operation: 'created' | 'updated' | 'started',
  runId?: string,
): ProductDeliveryEnvelope {
  return {
    version: PRODUCT_DELIVERY_VERSION,
    operation,
    primary: {
      kind: 'automation',
      id: automation.id,
      ...(runId ? { runId } : {}),
      title: automation.name,
      summary: automation.description?.trim() || undefined,
      status: automation.enabled ? 'enabled' : 'paused',
      revision: String(automation.updatedAtMs),
      capabilities: [
        'open',
        'edit',
        'run',
        automation.enabled ? 'pause' : 'resume',
      ],
    },
  };
}

function normalizeSchedule(input: Static<typeof PersonalScheduleInputSchema>): AutomationSchedule {
  if (input.kind === 'once') {
    if (input.afterMs !== undefined) {
      return AutomationScheduleSchema.parse({
        kind: 'once',
        at: new Date(Date.now() + input.afterMs).toISOString(),
      });
    }
    return AutomationScheduleSchema.parse({ kind: 'once', at: input.at });
  }
  if (input.kind === 'interval') {
    return AutomationScheduleSchema.parse({
      kind: 'interval',
      everyMs: input.everyMs,
      ...(input.anchorMs !== undefined ? { anchorMs: input.anchorMs } : {}),
    });
  }
  return AutomationScheduleSchema.parse({
    kind: 'cron',
    expr: input.expr,
    ...(input.tz?.trim() ? { tz: input.tz.trim() } : {}),
  });
}

function summarizeSchedule(item: Automation) {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    enabled: item.enabled,
    schedule: item.trigger.kind === 'schedule' ? item.trigger.schedule : undefined,
    instruction: item.action.kind === 'personal_task' ? item.action.instruction : undefined,
    locale: item.action.kind === 'personal_task' ? item.action.locale : undefined,
    notificationPolicy: item.delivery?.notificationPolicy,
    nextRunAt: item.state.nextRunAtMs ? new Date(item.state.nextRunAtMs).toISOString() : null,
    lastRunAt: item.state.lastRunAtMs ? new Date(item.state.lastRunAtMs).toISOString() : null,
    lastRunStatus: item.state.lastRunStatus ?? null,
    revision: item.updatedAtMs,
  };
}

function resolveLocale(conversationId: string, config: Config | undefined, explicit?: 'zh' | 'en'): 'zh' | 'en' {
  if (explicit) return explicit;
  const resolved = config ? resolveResponseLanguageForSession(config, conversationId) : 'en';
  return resolved.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function createPersonalScheduleTool(
  deps: PersonalScheduleToolDeps,
): AgentTool<typeof PersonalScheduleToolSchema, Record<string, unknown>> {
  return {
    name: 'personal_schedule',
    label: 'Personal Schedules',
    description:
      'Create, inspect, edit, pause, resume, delete, or run Personal Agent scheduled tasks in this chat. '
      + 'Use for explicit timed or recurring requests (daily briefings, weekly digests, fixed-time or countdown reminders). '
      + 'Do not use for vague follow-ups without a fixed schedule (use personal_attention instead) or for cross-project/webhook/MCP automations (delegate via personal_task). '
      + 'Use an explicit IANA timezone (e.g. Asia/Shanghai) for wall-clock cron schedules; use once with at or afterMs for one-time reminders. '
      + 'Only claim a schedule is saved after a successful tool result, and state the actual nextRunAt. '
      + 'Do not run a schedule unless the user explicitly asks to test or run it now.',
    parameters: PersonalScheduleToolSchema,
    async execute(_toolCallId, params: PersonalScheduleToolInput) {
      const service = deps.getAutomationService();
      if (!service) return textResult('Schedule service is unavailable.', { ok: false });

      const conversationId = deps.getCurrentConversationId();
      if (!conversationId) return textResult('No active personal conversation.', { ok: false });

      const profile = getPersonalAgentByConversation(conversationId);
      if (profile?.state !== 'ready') {
        return textResult('Personal Agent is unavailable for scheduling.', { ok: false });
      }

      switch (params.command) {
        case 'list': {
          const all = await service.list();
          const schedules = all
            .filter(item => isPersonalSchedule(item, profile.conversationId, profile.agentId))
            .map(summarizeSchedule);
          return textResult(JSON.stringify({ schedules }), { ok: true, schedules });
        }

        case 'get': {
          const id = params.scheduleId?.trim();
          if (!id) return textResult('scheduleId is required.', { ok: false });
          const item = getAutomation(id);
          if (!isPersonalSchedule(item, profile.conversationId, profile.agentId)) {
            return textResult(`Personal schedule not found: ${id}`, { ok: false });
          }
          const summary = summarizeSchedule(item);
          return textResult(JSON.stringify(summary), { ok: true, schedule: summary });
        }

        case 'create': {
          const name = params.name?.trim();
          const instruction = params.instruction?.trim();
          if (!name) return textResult('name is required to create a schedule.', { ok: false });
          if (!instruction) return textResult('instruction is required to create a schedule.', { ok: false });
          if (!params.schedule) return textResult('schedule is required to create a schedule.', { ok: false });
          const schedule = normalizeSchedule(params.schedule);
          const locale = resolveLocale(conversationId, deps.getConfig?.(), params.locale);
          const notificationPolicy: AutomationNotificationPolicy = params.notificationPolicy ?? 'all';
          const created = await service.create(personalScheduleInput(profile, {
            name,
            ...(params.description?.trim() ? { description: params.description.trim() } : {}),
            instruction,
            locale,
            schedule,
            ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
            notificationPolicy,
          }));
          const summary = summarizeSchedule(created);
          return textResult(JSON.stringify({ ok: true, schedule: summary }), {
            ok: true,
            schedule: summary,
            delivery: scheduleDelivery(created, 'created'),
          });
        }

        case 'update':
        case 'pause':
        case 'resume': {
          const id = params.scheduleId?.trim();
          if (!id) return textResult('scheduleId is required.', { ok: false });
          const nextEnabled = params.command === 'pause'
            ? false
            : params.command === 'resume'
              ? true
              : params.enabled;
          const nextSchedule = params.schedule ? normalizeSchedule(params.schedule) : undefined;
          const result = runSqliteWriteTransaction(() => {
            const current = getAutomation(id);
            if (!isPersonalSchedule(current, profile.conversationId, profile.agentId)) {
              return { status: 'missing' as const };
            }
            if (params.expectedRevision !== undefined && current.updatedAtMs !== params.expectedRevision) {
              return { status: 'conflict' as const, currentRevision: current.updatedAtMs };
            }
            const patch: Record<string, unknown> = {};
            if (params.name?.trim()) patch.name = params.name.trim();
            if (params.description !== undefined) patch.description = params.description.trim() || undefined;
            if (nextEnabled !== undefined) patch.enabled = nextEnabled;
            if (nextSchedule) patch.trigger = { kind: 'schedule', schedule: nextSchedule };
            if (params.instruction?.trim() || params.locale) {
              patch.action = {
                ...current.action,
                instruction: params.instruction?.trim() ?? current.action.instruction,
                locale: params.locale ?? current.action.locale,
              };
            }
            if (params.notificationPolicy) {
              patch.delivery = {
                ...current.delivery,
                notificationPolicy: params.notificationPolicy,
              };
            }
            if (Object.keys(patch).length === 0) {
              return { status: 'empty' as const };
            }
            const updated = service.updateAtomically(id, patch);
            return { status: 'updated' as const, automation: updated };
          });
          if (result.status === 'missing') return textResult(`Personal schedule not found: ${id}`, { ok: false });
          if (result.status === 'conflict') {
            return textResult(`Schedule changed concurrently (current revision: ${result.currentRevision}). Read again before updating.`, { ok: false });
          }
          if (result.status === 'empty') return textResult('At least one field to update is required.', { ok: false });
          service.refreshSchedule();
          const summary = summarizeSchedule(result.automation);
          return textResult(JSON.stringify({ ok: true, schedule: summary }), {
            ok: true,
            schedule: summary,
            delivery: scheduleDelivery(result.automation, 'updated'),
          });
        }

        case 'delete': {
          const id = params.scheduleId?.trim();
          if (!id) return textResult('scheduleId is required.', { ok: false });
          const current = getAutomation(id);
          if (!isPersonalSchedule(current, profile.conversationId, profile.agentId)) {
            return textResult(`Personal schedule not found: ${id}`, { ok: false });
          }
          if (params.expectedRevision !== undefined && current.updatedAtMs !== params.expectedRevision) {
            return textResult(`Schedule changed concurrently (current revision: ${current.updatedAtMs}). Read again before deleting.`, { ok: false });
          }
          const removed = await service.remove(id);
          return textResult(JSON.stringify({ ok: removed, id }), { ok: removed, id });
        }

        case 'run': {
          const id = params.scheduleId?.trim();
          if (!id) return textResult('scheduleId is required.', { ok: false });
          const current = getAutomation(id);
          if (!isPersonalSchedule(current, profile.conversationId, profile.agentId)) {
            return textResult(`Personal schedule not found: ${id}`, { ok: false });
          }
          const run = await service.runNow(id);
          return textResult(JSON.stringify({ ok: true, runId: run.id, status: run.status }), {
            ok: true,
            runId: run.id,
            status: run.status,
            delivery: scheduleDelivery(current, 'started', run.id),
          });
        }
      }
    },
  };
}
