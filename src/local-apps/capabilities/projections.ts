import { z } from 'zod';
import { NoteRecordSchema, TaskPhaseSchema, TaskPrioritySchema, TaskResolutionSchema, TaskOperationalStateSchema } from '@xopcai/gateway-contract';
import { AutomationSchema, AutomationRunSchema } from '@xopcai/gateway-contract';
import { AutomationRunEventSchema } from '@xopcai/gateway-contract';
import { ProjectRecordSchema, ProjectMilestoneSchema, ProjectUpdateSchema } from '@xopcai/gateway-contract';

export const LocalAppProjectSchema = ProjectRecordSchema.pick({ id: true, name: true, status: true,
  health: true, version: true, createdAt: true, updatedAt: true }).strip().extend({
    description: z.string().optional(), outcome: z.string().optional(), targetAt: z.number().optional(),
  });
export const LocalAppProjectOutputSchema = z.object({ ok: z.literal(true), project: LocalAppProjectSchema });
export const LocalAppProjectListSchema = z.object({ ok: z.literal(true), items: z.array(LocalAppProjectSchema), total: z.number(),
  limit: z.number(), offset: z.number(), hasMore: z.boolean() });
export const LocalAppMilestoneSchema = ProjectMilestoneSchema.strip().extend({ description: z.string().optional(), targetAt: z.number().optional() });
export const LocalAppProgressSchema = ProjectUpdateSchema.strip().extend({ progress: z.array(z.string()), risks: z.array(z.string()), nextSteps: z.array(z.string()) });
export const LocalAppMilestonesSchema = z.object({ ok: z.literal(true), projectId: z.string(), items: z.array(LocalAppMilestoneSchema) });
export const LocalAppUpdatesSchema = z.object({ ok: z.literal(true), projectId: z.string(), items: z.array(LocalAppProgressSchema) });
export const LocalAppMilestoneOutputSchema = LocalAppProjectOutputSchema.extend({ milestone: LocalAppMilestoneSchema });
export const LocalAppProgressOutputSchema = LocalAppProjectOutputSchema.extend({ update: LocalAppProgressSchema });

export const LocalAppAutomationSchema = AutomationSchema.pick({ id: true, name: true, description: true,
  enabled: true, createdAtMs: true, updatedAtMs: true });
export const LocalAppAutomationOutputSchema = z.object({ ok: z.literal(true), automation: LocalAppAutomationSchema });
export const LocalAppAutomationListSchema = z.object({ ok: z.literal(true), items: z.array(LocalAppAutomationSchema) });
export const LocalAppAutomationRunSchema = AutomationRunSchema.pick({ id: true, automationId: true, status: true,
  createdAtMs: true, startedAtMs: true, endedAtMs: true, durationMs: true, currentPhase: true,
  cancelRequestedAtMs: true, cancelConfirmedAtMs: true }).extend({ summary: z.string().max(32768).optional(),
  failureCode: z.enum(['authorization_ended', 'budget_exhausted', 'execution_failed']).optional() });
export function projectLocalAppRun<T extends { summary?: string; error?: string; status: string }>(run: T) {
  return { ...run, summary: run.summary?.slice(0, 32768), failureCode: ['failed', 'timeout', 'cancelled'].includes(run.status)
    ? /authority|revok|expir/i.test(run.error ?? '') ? 'authorization_ended' as const
      : /budget|cost|limit exhausted/i.test(run.error ?? '') ? 'budget_exhausted' as const : 'execution_failed' as const : undefined };
}
export const LocalAppAutomationRunOutputSchema = z.object({ ok: z.literal(true), run: LocalAppAutomationRunSchema });
export const LocalAppAutomationSubmitSchema = LocalAppAutomationOutputSchema.extend({ run: LocalAppAutomationRunSchema });
export const LocalAppAutomationHistorySchema = z.object({ ok: z.literal(true), items: z.array(LocalAppAutomationRunSchema),
  hasMore: z.boolean(), nextCursor: z.string().optional() });
export const LocalAppRunEventSchema = AutomationRunEventSchema.pick({ id: true, runId: true, type: true, createdAtMs: true });
export const LocalAppRunEventsSchema = z.object({ ok: z.literal(true), events: z.array(LocalAppRunEventSchema), truncated: z.boolean() });

export const LocalAppNoteSchema = NoteRecordSchema.pick({ id: true, title: true, markdown: true,
  kind: true, status: true, createdAt: true, updatedAt: true, localVersion: true }).strip()
  .extend({ remoteVersion: z.number().optional(), tags: z.array(z.string()).optional(), pinned: z.boolean().optional() });
export const LocalAppNoteOutputSchema = z.object({ note: LocalAppNoteSchema });
export const LocalAppNoteIndexSchema = LocalAppNoteSchema.omit({ markdown: true }).extend({ snippet: z.string().optional() });
export const LocalAppNoteListSchema = z.object({ items: z.array(LocalAppNoteIndexSchema), total: z.number(),
  limit: z.number(), offset: z.number(), hasMore: z.boolean() });
export const LocalAppTaskSchema = z.object({ id: z.string(), title: z.string(), phase: TaskPhaseSchema,
  body: z.string().optional(),
  resolution: TaskResolutionSchema.optional(), priority: TaskPrioritySchema, dueAt: z.number().optional(),
  version: z.number(), createdAt: z.number(), updatedAt: z.number() });
export const LocalAppTaskModelSchema = z.object({ task: LocalAppTaskSchema, operationalState: TaskOperationalStateSchema });
export const LocalAppTaskOutputSchema = LocalAppTaskModelSchema.extend({ ok: z.literal(true) });
export const LocalAppTaskListSchema = z.object({ ok: z.literal(true), items: z.array(LocalAppTaskModelSchema), total: z.number() });
export const LocalAppTaskMutationSchema = z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), model: LocalAppTaskModelSchema }),
  z.object({ ok: z.literal(false), reason: z.enum(['not_found', 'conflict', 'invalid_transition', 'blocked']), model: LocalAppTaskModelSchema.optional() })]);
export const LocalAppTaskEditSchema = z.object({ ok: z.literal(true), task: LocalAppTaskSchema });
