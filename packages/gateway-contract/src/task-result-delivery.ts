import { z } from 'zod';

import { TurnOutcomeSchema } from './turn-outcome.js';

/** A worker outcome delivered independently of the main Agent's execution. */
export const TaskResultDeliverySchema = z.object({
  version: z.literal(1),
  deliveryId: z.string().min(1),
  taskId: z.string().min(1),
  taskRunId: z.string().min(1),
  taskTitle: z.string().min(1).max(500),
  conversationId: z.string().min(1),
  originTranscriptId: z.string().min(1),
  requestInputId: z.string().optional(),
  assignmentEpoch: z.number().int().nonnegative(),
  resultRevision: z.number().int().positive().optional(),
  previousResultId: z.string().optional(),
  contractVersion: z.number().int().positive().optional(),
  instructionSequence: z.number().int().nonnegative().optional(),
  adoption: z.array(z.object({ entryId: z.string(), sequence: z.number().int(),
    status: z.enum(['applied', 'partially_applied', 'not_applied', 'superseded']),
    verification: z.enum(['passed', 'failed', 'unverified']), claimIds: z.array(z.string()), note: z.string() })).optional(),
  outcome: TurnOutcomeSchema,
  text: z.string().optional(),
  createdAt: z.number(),
});

export type TaskResultDelivery = z.infer<typeof TaskResultDeliverySchema>;
export const TASK_RESULT_DELIVERY_TYPE = 'task_result_delivery';

export function parseTaskResultDelivery(value: unknown): TaskResultDelivery | undefined {
  const result = TaskResultDeliverySchema.safeParse(value);
  return result.success ? result.data : undefined;
}
