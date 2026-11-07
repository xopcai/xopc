import { z } from 'zod';
import { NoteRecordSchema, TaskPhaseSchema, TaskPrioritySchema, TaskResolutionSchema, TaskOperationalStateSchema } from '@xopcai/gateway-contract';

export const LocalAppNoteSchema = NoteRecordSchema.pick({ id: true, title: true, markdown: true,
  kind: true, status: true, createdAt: true, updatedAt: true, localVersion: true }).strip()
  .extend({ remoteVersion: z.number().optional(), tags: z.array(z.string()).optional(), pinned: z.boolean().optional() });
export const LocalAppNoteOutputSchema = z.object({ note: LocalAppNoteSchema });
export const LocalAppNoteIndexSchema = LocalAppNoteSchema.omit({ markdown: true }).extend({ snippet: z.string().optional() });
export const LocalAppNoteListSchema = z.object({ items: z.array(LocalAppNoteIndexSchema), total: z.number(),
  limit: z.number(), offset: z.number(), hasMore: z.boolean() });
export const LocalAppTaskSchema = z.object({ id: z.string(), title: z.string(), phase: TaskPhaseSchema,
  resolution: TaskResolutionSchema.optional(), priority: TaskPrioritySchema, dueAt: z.number().optional(),
  version: z.number(), createdAt: z.number(), updatedAt: z.number() });
export const LocalAppTaskModelSchema = z.object({ task: LocalAppTaskSchema, operationalState: TaskOperationalStateSchema });
export const LocalAppTaskOutputSchema = LocalAppTaskModelSchema.extend({ ok: z.literal(true) });
export const LocalAppTaskListSchema = z.object({ ok: z.literal(true), items: z.array(LocalAppTaskModelSchema), total: z.number() });
