import { z } from 'zod';

import { FollowUpSchema, FollowUpCandidateSchema } from './follow-ups.js';
import { ObservationStarterSchema } from './observation-starters.js';
import { AutomationScheduleSchema } from './automations.js';

export const RoutineMethodSchema = z.object({
  version: z.number(), baseVersion: z.number().nullable(), additions: z.array(z.string()),
  status: z.enum(['candidate','validating','validated','approved','rejected']), validationTaskId: z.string().nullable(),
  validation: z.enum(['unverified','passed','failed']),
});
export const RoutineSchema = z.object({
  id: z.string(), topicId: z.string(), title: z.string(), status: z.enum(['active','paused','ended']), revision: z.number(),
  adoptedVersion: z.number(), automationId: z.string(), validUntil: z.number(),
  schedule: AutomationScheduleSchema.nullable(), methods: z.array(RoutineMethodSchema),
  executions: z.array(z.object({ taskId: z.string(), runId: z.string(), version: z.number(), status: z.string(), verdict: z.string().nullable() })),
});
export const RoutineAdoptRequestSchema = z.strictObject({
  topicId: z.string().min(1), trialTaskId: z.string().min(1), expectedTaskVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(200), schedule: AutomationScheduleSchema,
  validUntil: z.number().int().positive(),
});
export const RoutineCommandRequestSchema = z.strictObject({
  expectedRevision: z.number().int().positive(), idempotencyKey: z.string().min(1).max(200),
  command: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('pause') }), z.strictObject({ kind: z.literal('resume') }), z.strictObject({ kind: z.literal('end') }),
    z.strictObject({ kind: z.literal('configure'), schedule: AutomationScheduleSchema, validUntil: z.number().int().positive() }),
    z.strictObject({ kind: z.literal('validate'), version: z.number().int().positive() }),
    z.strictObject({ kind: z.literal('adopt_method'), version: z.number().int().positive() }),
    z.strictObject({ kind: z.literal('rollback'), version: z.number().int().positive() }),
    z.strictObject({ kind: z.literal('reject_method'), version: z.number().int().positive() }),
  ]),
});
export type Routine = z.infer<typeof RoutineSchema>;
export type RoutineAdoptRequest = z.infer<typeof RoutineAdoptRequestSchema>;
export type RoutineCommandRequest = z.infer<typeof RoutineCommandRequestSchema>;

export const ObservationFeedbackSchema = z.object({
  id: z.string(), text: z.string(), scope: z.enum(['once', 'project', 'similar']),
  status: z.enum(['active', 'retracted']), createdAt: z.number(),
});
export const ObservationTopicSchema = z.object({
  id: z.string(), title: z.string(), projectId: z.string().optional(), revision: z.number(),
  entries: z.array(z.object({ id: z.string(), kind: z.string(), text: z.string(), sourceRef: z.string().nullish(), createdAt: z.number() })),
  feedback: z.array(ObservationFeedbackSchema),
  trials: z.array(z.object({ taskId: z.string(), title: z.string(), phase: z.string(), resolution: z.string().nullable(), taskVersion: z.number().optional() })),
  routine: RoutineSchema.optional(),
});
export const ObservationStateSchema = z.object({
  id: z.string().optional(), status: z.enum(['disabled', 'active', 'paused']), revision: z.number(),
  analyzedRevision: z.number(), lastProcessedAt: z.number().nullable(), starters: z.array(ObservationStarterSchema).optional(), followUps: z.array(FollowUpSchema).optional(), followUpCandidates: z.array(FollowUpCandidateSchema).optional(), topics: z.array(ObservationTopicSchema),
});
export const ObservationCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('start'), backfillDays: z.number().int().min(0).max(30).default(30) }),
  z.strictObject({ kind: z.literal('pause') }),
  z.strictObject({ kind: z.literal('resume'), mode: z.enum(['catch_up', 'new_only']) }),
  z.strictObject({ kind: z.literal('feedback'), topicId: z.string().min(1), text: z.string().trim().min(1).max(1000), scope: z.enum(['once','project','similar']) }),
  z.strictObject({ kind: z.literal('retract'), topicId: z.string().min(1), feedbackId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('forget'), topicId: z.string().min(1) }),
]);
export const ObservationCommandRequestSchema = z.strictObject({
  idempotencyKey: z.string().min(1).max(200), expectedRevision: z.number().int().nonnegative(),
  command: ObservationCommandSchema,
});
export const ObservationTrialRequestSchema = z.strictObject({
  topicId: z.string().min(1), opportunityId: z.string().min(1),
  expectedRevision: z.number().int().positive(), expectedOpportunityRevision: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(200),
});
export type ObservationState = z.infer<typeof ObservationStateSchema>;
export type ObservationCommandRequest = z.infer<typeof ObservationCommandRequestSchema>;
export type ObservationTrialRequest = z.infer<typeof ObservationTrialRequestSchema>;
