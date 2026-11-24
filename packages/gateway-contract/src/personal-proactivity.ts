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
export const PersonalOneShotDestinationSchema = z.enum(['personal', 'workbench']);
export type PersonalOneShotDestination = z.infer<typeof PersonalOneShotDestinationSchema>;

export const PersonalOneShotTerminalReasonSchema = z.enum([
  'delivered',
  'resolved_before_check',
  'stopped',
  'expired',
  'task_closed',
  'task_deleted',
  'access_revoked',
  'conversation_reset',
]);
export type PersonalOneShotTerminalReason = z.infer<typeof PersonalOneShotTerminalReasonSchema>;

export const PersonalOneShotDisplayStateSchema = z.enum([
  'scheduled',
  'queued_delivery',
  'delivered',
  'resolved_before_check',
  'stopped',
  'expired',
  'ended',
]);
export type PersonalOneShotDisplayState = z.infer<typeof PersonalOneShotDisplayStateSchema>;

export const PersonalOneShotOutreachSummarySchema = z.object({
  outreachId: z.string().uuid(),
  state: z.enum(['decided', 'ready', 'published', 'stale', 'cancelled']),
  destination: PersonalOneShotDestinationSchema,
  text: z.string().nullable().optional(),
  publishedAt: z.number().nullable(),
  acknowledgedAt: z.number().nullable(),
});
export type PersonalOneShotOutreachSummary = z.infer<typeof PersonalOneShotOutreachSummarySchema>;

/**
 * Personal Agent One-Shot Conditional Follow-Up (`personal_attention_threads` with `follow_up_mode = 'one_shot'`).
 * Represents a single-check conditional reminder tied to one active `TaskWait` (`user_input | approval`).
 *
 * Distinct from Home Intelligence Continuing Goals (`HomeContinuingGoal` / `FollowUp` in `./follow-ups.ts`,
 * stored in `home_followups`).
 */
export const PersonalOneShotFollowUpDtoSchema = z.object({
  followUpId: z.string().uuid(),
  status: z.enum(['candidate', 'active', 'paused', 'completed', 'expired']),
  displayState: PersonalOneShotDisplayStateSchema,
  revision: z.number().int().positive(),
  subject: z.string(),
  summary: z.string(),
  taskId: z.string(),
  taskTitle: z.string().optional(),
  projectId: z.string().nullable(),
  projectName: z.string().optional(),
  waitId: z.string(),
  waitKind: z.enum(['user_input', 'approval']).optional(),
  waitSummary: z.string().optional(),
  destination: PersonalOneShotDestinationSchema,
  timezone: z.string(),
  checkAt: z.number(),
  validUntil: z.number(),
  lastCheckedAt: z.number().nullable(),
  lastCheckError: z.string().nullable(),
  terminalReason: PersonalOneShotTerminalReasonSchema.nullable(),
  conversationId: z.string(),
  outreach: PersonalOneShotOutreachSummarySchema.nullable(),
  sourcesAvailable: z.boolean(),
  sources: z.array(z.object({
    conversationId: z.string(),
    transcriptId: z.string(),
    entryId: z.string(),
    excerpt: z.string(),
  })),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type PersonalOneShotFollowUpDto = z.infer<typeof PersonalOneShotFollowUpDtoSchema>;

export const PersonalOneShotWorkbenchAlertSchema = z.object({
  followUpId: z.string().uuid(),
  outreachId: z.string().uuid(),
  taskId: z.string(),
  waitId: z.string(),
  title: z.string(),
  text: z.string(),
  publishedAt: z.number(),
});
export type PersonalOneShotWorkbenchAlert = z.infer<typeof PersonalOneShotWorkbenchAlertSchema>;

export const StopPersonalOneShotFollowUpRequestSchema = z.object({
  expectedRevision: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(1).max(200),
}).strict();
export type StopPersonalOneShotFollowUpRequest = z.infer<typeof StopPersonalOneShotFollowUpRequestSchema>;

export const StopPersonalOneShotFollowUpResponseSchema = z.object({
  outcome: z.enum(['stopped', 'already_delivered', 'already_ended']),
  followUp: PersonalOneShotFollowUpDtoSchema,
}).strict();
export type StopPersonalOneShotFollowUpResponse = z.infer<typeof StopPersonalOneShotFollowUpResponseSchema>;

export const PersonalProvenanceDetailSchema = z.object({
  provenance: PersonalProvenanceSchema,
  thread: z.object({ id: z.string(), subject: z.string(), status: z.string(), revision: z.number(), nextCheckAt: z.number().nullable() }),
  whyNow: z.string(),
  sources: z.array(z.object({ conversationId: z.string(), transcriptId: z.string(), entryId: z.string(), excerpt: z.string() })),
  sourcesAvailable: z.boolean(),
  strategy: PersonalStrategyStateSchema.optional(),
  oneShotFollowUp: PersonalOneShotFollowUpDtoSchema.optional(),
});
export type PersonalProvenanceDetail = z.infer<typeof PersonalProvenanceDetailSchema>;
