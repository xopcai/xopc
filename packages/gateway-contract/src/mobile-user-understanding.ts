import { z } from 'zod';

export const MobileUnderstandingFilterSchema = z.enum(['all', 'explicit', 'learned', 'review']);

export const MobileUnderstandingScopeSchema = z.object({
  type: z.enum(['global', 'agent', 'workspace', 'project', 'session']),
  id: z.string().optional(),
});

export const MobileUnderstandingSourceSchema = z.object({
  id: z.string(),
  kind: z.enum(['user', 'conversation', 'connector', 'work_folder', 'local_source', 'inference']),
  label: z.string().optional(),
  category: z.string().optional(),
  observedAt: z.number().int().nonnegative(),
});

export const MobileUnderstandingItemSchema = z.object({
  id: z.string(),
  predicate: z.string(),
  statement: z.string(),
  kind: z.enum([
    'identity', 'preference', 'value', 'routine', 'capability', 'relationship',
    'current_state', 'derived_insight',
  ]),
  status: z.enum(['candidate', 'active', 'needs_review', 'conflicted', 'stale']),
  authority: z.enum(['user_explicit', 'user_observed', 'system_inferred', 'external_untrusted']),
  usable: z.boolean(),
  confidence: z.number().min(0).max(1),
  volatility: z.enum(['stable', 'slow', 'dynamic', 'event']),
  layer: z.enum(['fact', 'pattern', 'interpretation']),
  independentSourceCount: z.number().int().nonnegative(),
  observedAt: z.number().int().nonnegative(),
  recordedAt: z.number().int().nonnegative(),
  validTo: z.number().int().nonnegative().optional(),
  scope: MobileUnderstandingScopeSchema,
  sources: z.array(MobileUnderstandingSourceSchema),
});

export const MobileUserProfileSchema = z.object({
  callName: z.string(),
  role: z.string(),
  pronouns: z.string(),
  timezone: z.string(),
  locale: z.string(),
});

export const MobileUserGoalSchema = z.object({
  id: z.string(),
  title: z.string(),
  desiredOutcome: z.string(),
  status: z.enum(['proposed', 'active', 'paused']),
  targetAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative(),
  isPrimary: z.boolean(),
});

export const MobileUserUnderstandingSummarySchema = z.object({
  profile: MobileUserProfileSchema,
  suggestedCallName: z.string(),
  counts: z.object({
    total: z.number().int().nonnegative(),
    explicit: z.number().int().nonnegative(),
    learned: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    workMemory: z.number().int().nonnegative(),
  }),
  primaryFocus: z.object({
    id: z.string(),
    title: z.string(),
    desiredOutcome: z.string().optional(),
    validTo: z.number().int().nonnegative(),
  }).optional(),
  goals: z.array(MobileUserGoalSchema).max(5).default([]),
  recent: z.array(MobileUnderstandingItemSchema).max(3),
  rules: z.array(z.object({
    id: z.string(),
    statement: z.string(),
    category: z.enum(['communication', 'execution', 'boundary', 'routine', 'initiative']),
  })).max(3),
});

export const MobileUnderstandingPageSchema = z.object({
  items: z.array(MobileUnderstandingItemSchema),
  nextCursor: z.string().optional(),
});

export type MobileUnderstandingFilter = z.infer<typeof MobileUnderstandingFilterSchema>;
export type MobileUnderstandingItem = z.infer<typeof MobileUnderstandingItemSchema>;
export type MobileUserGoal = z.infer<typeof MobileUserGoalSchema>;
export type MobileUserUnderstandingSummary = z.infer<typeof MobileUserUnderstandingSummarySchema>;
export type MobileUnderstandingPage = z.infer<typeof MobileUnderstandingPageSchema>;
