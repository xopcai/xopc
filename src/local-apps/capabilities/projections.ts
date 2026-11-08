import { z } from 'zod';
import { NoteRecordSchema, TaskPhaseSchema, TaskPrioritySchema, TaskResolutionSchema, TaskOperationalStateSchema } from '@xopcai/gateway-contract';
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
