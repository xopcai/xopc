import { z } from 'zod';

export const PERSONAL_PROACTIVE_MESSAGE_TYPE = 'personal_proactive_message';
export const PersonalProvenanceSchema = z.object({
  outreachId: z.string().uuid(),
  reasonKind: z.enum(['follow_up', 'discussion', 'change', 'prepared']),
  authority: z.enum(['user_explicit', 'inferred']),
}).strict();
export type PersonalProvenance = z.infer<typeof PersonalProvenanceSchema>;
export const PersonalProactiveMessageSchema = z.object({
  version: z.literal(1),
  outreachId: z.string().uuid(),
  threadId: z.string().uuid(),
  conversationId: z.string().uuid(),
  originTranscriptId: z.string().min(1),
  text: z.string().trim().min(1).max(12000),
  provenance: PersonalProvenanceSchema,
  createdAt: z.number().int().nonnegative(),
}).strict();
export type PersonalProactiveMessage = z.infer<typeof PersonalProactiveMessageSchema>;
export function parsePersonalProactiveMessage(value: unknown): PersonalProactiveMessage | undefined {
  const result = PersonalProactiveMessageSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
export const PersonalProactivitySettingsSchema = z.object({
  revision: z.number().int().positive().default(1),
  mode: z.enum(['off', 'follow_up', 'balanced']).default('balanced'),
  timezone: z.string().max(100).default('Asia/Shanghai').refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'Invalid timezone'),
  quietStart: z.number().int().min(0).max(23).default(22),
  quietEnd: z.number().int().min(0).max(23).default(8),
  dailyMessages: z.number().int().min(0).max(10).default(2),
  dailyModelCalls: z.number().int().min(0).max(100).default(12),
}).strict();
export type PersonalProactivitySettings = z.infer<typeof PersonalProactivitySettingsSchema>;
export const PersonalFeedbackSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  kind: z.enum(['helpful', 'irrelevant', 'stop', 'defer', 'adjust']),
  scope: z.enum(['message', 'thread']).default('message'),
  until: z.number().int().positive().optional(),
  preparation: z.enum(['brief', 'thorough']).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === 'defer' && !value.until) ctx.addIssue({ code: 'custom', message: 'A defer time is required' });
  if (value.kind === 'adjust' && !value.preparation) ctx.addIssue({ code: 'custom', message: 'A preparation preference is required' });
  if ((value.kind === 'stop' || value.kind === 'adjust') && value.scope !== 'thread') {
    ctx.addIssue({ code: 'custom', message: 'A lasting change requires thread scope' });
  }
});
export type PersonalFeedback = z.infer<typeof PersonalFeedbackSchema>;
export const PersonalStrategyRollbackSchema = z.object({
  versionId: z.string().uuid(), revision: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(200),
}).strict();
export const PersonalStrategyStateSchema = z.object({
  preparation: z.enum(['brief', 'thorough']).nullable(),
  versions: z.array(z.object({ id: z.string().uuid(), revision: z.number().int().positive(),
    kind: z.enum(['stop', 'defer', 'adjust', 'rollback']), createdAt: z.number(),
    preparation: z.enum(['brief', 'thorough']).nullable(),
  })),
});
export const PersonalInterestCandidateSchema = z.object({
  id: z.string().uuid(), subject: z.string(), summary: z.string(),
  status: z.enum(['candidate', 'completed', 'expired']), confidence: z.number().min(0).max(1),
  independentStatements: z.number().int(), independentDays: z.number().int(),
  lastSupportedAt: z.number(), expiresAt: z.number(),
  sources: z.array(z.object({ entryId: z.string(), excerpt: z.string(), observedAt: z.number() })),
});
export const PersonalProvenanceDetailSchema = z.object({
  provenance: PersonalProvenanceSchema,
  thread: z.object({ id: z.string(), subject: z.string(), status: z.string(), revision: z.number(), nextCheckAt: z.number().nullable() }),
  whyNow: z.string(),
  sources: z.array(z.object({ conversationId: z.string(), transcriptId: z.string(), entryId: z.string(), excerpt: z.string() })),
  sourcesAvailable: z.boolean(),
  strategy: PersonalStrategyStateSchema.optional(),
});
export type PersonalProvenanceDetail = z.infer<typeof PersonalProvenanceDetailSchema>;
