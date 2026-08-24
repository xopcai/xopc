import {
  AutomationMetricsSchema,
  AutomationRunEventSchema,
  AutomationRunSchema,
  AutomationSchema,
  type Automation,
  type AutomationMetrics,
  type AutomationRun,
  type AutomationRunEvent,
} from '@xopcai/gateway-contract';
import { z } from 'zod';

import { apiFetch, formatApiHttpError } from '../api/client';

export const AUTOMATION_RUNS_LIMIT = 50;

export type ScheduledAgentAutomationInput = {
  name: string;
  cronExpression: string;
  instruction: string;
};

function encId(id: string): string {
  return encodeURIComponent(id);
}

async function parseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

function apiErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const error = (data as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}

async function expectOk(response: Response): Promise<unknown> {
  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error(formatApiHttpError(
      response.status,
      response.statusText,
      apiErrorMessage(data),
    ));
  }
  return data;
}

function scheduledAgentBody(input: ScheduledAgentAutomationInput) {
  return {
    name: input.name.trim(),
    enabled: true,
    trigger: {
      kind: 'schedule' as const,
      schedule: { kind: 'cron' as const, expr: input.cronExpression },
    },
    action: { kind: 'agent' as const, instruction: input.instruction.trim() },
    afterRun: { kind: 'saveToSession' as const },
  };
}

export function isMobileEditableAutomation(automation: Automation): boolean {
  return automation.trigger.kind === 'schedule'
    && automation.trigger.schedule.kind === 'cron'
    && automation.action.kind === 'agent';
}

export function automationCronExpression(automation: Automation): string {
  return automation.trigger.kind === 'schedule' && automation.trigger.schedule.kind === 'cron'
    ? automation.trigger.schedule.expr
    : '';
}

export function automationInstruction(automation: Automation): string {
  return automation.action.kind === 'agent' ? automation.action.instruction.trim() : '';
}

export async function fetchAutomations(): Promise<Automation[]> {
  const data = await expectOk(await apiFetch('/api/automations'));
  return z.object({ automations: z.array(AutomationSchema) }).parse(data).automations;
}

export async function fetchAutomation(id: string): Promise<Automation | null> {
  const response = await apiFetch(`/api/automations/${encId(id)}`);
  if (response.status === 404) return null;
  const data = await expectOk(response);
  return z.object({ automation: AutomationSchema }).parse(data).automation;
}

export async function fetchAutomationMetrics(): Promise<AutomationMetrics> {
  return AutomationMetricsSchema.parse(await expectOk(await apiFetch('/api/automations/metrics')));
}

export async function createScheduledAgentAutomation(
  input: ScheduledAgentAutomationInput,
): Promise<Automation> {
  const data = await expectOk(await apiFetch('/api/automations', {
    method: 'POST',
    body: JSON.stringify(scheduledAgentBody(input)),
  }));
  return z.object({ automation: AutomationSchema }).parse(data).automation;
}

export async function updateScheduledAgentAutomation(
  id: string,
  input: ScheduledAgentAutomationInput,
): Promise<Automation> {
  const body = scheduledAgentBody(input);
  const data = await expectOk(await apiFetch(`/api/automations/${encId(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: body.name, trigger: body.trigger, action: body.action }),
  }));
  return z.object({ automation: AutomationSchema }).parse(data).automation;
}

export async function removeAutomation(id: string): Promise<void> {
  await expectOk(await apiFetch(`/api/automations/${encId(id)}`, { method: 'DELETE' }));
}

export async function setAutomationEnabled(id: string, enabled: boolean): Promise<Automation> {
  const action = enabled ? 'resume' : 'pause';
  const data = await expectOk(await apiFetch(`/api/automations/${encId(id)}/${action}`, {
    method: 'POST',
  }));
  return z.object({ automation: AutomationSchema }).parse(data).automation;
}

export async function runAutomationNow(id: string): Promise<AutomationRun> {
  const data = await expectOk(await apiFetch(`/api/automations/${encId(id)}/run`, { method: 'POST' }));
  return z.object({ run: AutomationRunSchema }).parse(data).run;
}

export async function fetchAutomationRuns(
  limit = AUTOMATION_RUNS_LIMIT,
  automationId?: string,
): Promise<AutomationRun[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (automationId) query.set('automationId', automationId);
  const data = await expectOk(await apiFetch(`/api/automation-runs?${query.toString()}`));
  return z.object({ runs: z.array(AutomationRunSchema) }).parse(data).runs;
}

export async function fetchAutomationRun(runId: string): Promise<AutomationRun | null> {
  const response = await apiFetch(`/api/automation-runs/${encId(runId)}`);
  if (response.status === 404) return null;
  const data = await expectOk(response);
  return z.object({ run: AutomationRunSchema }).parse(data).run;
}

export async function fetchAutomationRunEvents(runId: string): Promise<AutomationRunEvent[]> {
  const data = await expectOk(await apiFetch(`/api/automation-runs/${encId(runId)}/events`));
  return z.object({ events: z.array(AutomationRunEventSchema) }).parse(data).events;
}

export async function rerunAutomation(runId: string): Promise<AutomationRun> {
  const data = await expectOk(await apiFetch(`/api/automation-runs/${encId(runId)}/rerun`, { method: 'POST' }));
  return z.object({ run: AutomationRunSchema }).parse(data).run;
}

export async function cancelAutomationRun(runId: string): Promise<boolean> {
  const data = await expectOk(await apiFetch(`/api/automation-runs/${encId(runId)}/cancel`, { method: 'POST' }));
  return z.object({ cancelled: z.boolean() }).parse(data).cancelled;
}
