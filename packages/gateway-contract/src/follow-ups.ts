import { z } from 'zod';
const text = z.string().trim().min(1).max(1000);
export const TaskFollowUpHintSchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('next_step'), nextStep: text, reason: text }).strict(),
    z.object({ state: z.literal('waiting'), waitingFor: text, nextStep: text.optional() }).strict(),
    z.object({ state: z.literal('review_goal'), reason: text }).strict(),
]);
export const FollowUpCandidateSchema = z.object({ topicId: z.string(), goal: text, firstStep: text, evidence: text });
export const FollowUpSchema = z.object({
    id: z.string(), rootTaskId: z.string(), goal: text, criteria: z.array(text).min(1), topicIds: z.array(z.string()),
    status: z.enum(['working', 'waiting', 'review', 'paused', 'done', 'ended']), revision: z.number().int(),
    nextStep: z.string(), waitingFor: z.string(), summary: z.string(), autoContinue: z.boolean(), remainingSteps: z.number().int(), stopPending: z.boolean(),
    steps: z.array(z.object({ number: z.number().int(), taskId: z.string(), action: z.string(), status: z.string(), verified: z.boolean(), summary: z.string(), createdAt: z.number() })),
});
export const FollowUpCreateSchema = z.object({
    goal: text, criteria: z.array(text).min(1).max(10), firstStep: text, topicIds: z.array(z.string().min(1)).min(1).max(8),
    autoContinue: z.boolean().default(false), stepBudget: z.number().int().min(1).max(5).default(3), locale: z.enum(['zh', 'en']),
    expectedObservationRevision: z.number().int().positive(), idempotencyKey: z.string().min(1).max(120),
}).strict();
export const FollowUpCommandSchema = z.object({
    expectedRevision: z.number().int().positive(), idempotencyKey: z.string().min(1).max(120),
    command: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('pause') }).strict(), z.object({ kind: z.literal('resume') }).strict(), z.object({ kind: z.literal('end') }).strict(),
        z.object({ kind: z.literal('continue'), nextStep: text, stepBudget: z.number().int().min(1).max(5).default(1) }).strict(),
        z.object({ kind: z.literal('add_input'), text: z.string().trim().min(1).max(8000) }).strict(),
        z.object({ kind: z.literal('complete'), confirmedCriteria: z.array(z.number().int().nonnegative()).min(1).max(10), note: text }).strict(),
    ]),
}).strict();
export type FollowUp = z.infer<typeof FollowUpSchema>;
export type FollowUpCreate = z.infer<typeof FollowUpCreateSchema>;
export type FollowUpCommand = z.infer<typeof FollowUpCommandSchema>;
