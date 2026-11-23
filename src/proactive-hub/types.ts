import { z } from 'zod';

import type { AutomationEventEnvelope } from '../automations/domain/types.js';

export const ProactiveScopeTypeSchema = z.enum(['global', 'workspace', 'project', 'thread']);
export type ProactiveScopeType = z.infer<typeof ProactiveScopeTypeSchema>;

export const ProactiveRouteHintSchema = z.enum(['drop', 'digest_only', 'triage', 'force_scout']);
export type ProactiveRouteHint = z.infer<typeof ProactiveRouteHintSchema>;

export const ProactiveAuthoritySchema = z.enum(['system_default', 'user_explicit', 'rsi_adopted']);
export type ProactiveAuthority = z.infer<typeof ProactiveAuthoritySchema>;

export const ProactiveTierSchema = z.enum(['tier_s_chat', 'tier_a_inbox', 'tier_b_digest', 'tier_c_silent']);
export type ProactiveTier = z.infer<typeof ProactiveTierSchema>;

export const ProactiveCategorySchema = z.enum([
  'blocker',
  'prepared_draft',
  'meeting_prep',
  'folder_insight',
  'skill_candidate',
  'pulse_digest',
  'info',
]);
export type ProactiveCategory = z.infer<typeof ProactiveCategorySchema>;

export const ProactiveItemStateSchema = z.enum([
  'buffered_digest',
  'ready',
  'delivered',
  'acted',
  'snoozed',
  'muted',
  'stale',
  'expired',
]);
export type ProactiveItemState = z.infer<typeof ProactiveItemStateSchema>;

export const ProactiveMatchPredicatesSchema = z.object({
  equals: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  notEquals: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  in: z.record(z.string(), z.array(z.string().max(320)).max(50)).optional(),
  notIn: z.record(z.string(), z.array(z.string().max(320)).max(50)).optional(),
  contains: z.record(z.string(), z.string().max(320)).optional(),
  excludeAutomatedSenders: z.boolean().optional(),
}).strict();
export type ProactiveMatchPredicates = z.infer<typeof ProactiveMatchPredicatesSchema>;

export const CreateProactiveSubscriptionSchema = z.object({
  scopeType: ProactiveScopeTypeSchema.default('global'),
  scopeId: z.string().trim().min(1).max(200).optional(),
  sourcePattern: z.string().trim().min(1).max(160),
  eventTypePattern: z.string().trim().min(1).max(160),
  matchPredicates: ProactiveMatchPredicatesSchema.default({}),
  defaultRoute: ProactiveRouteHintSchema.default('triage'),
  coalesceWindowMs: z.number().int().min(0).max(86_400_000).default(180_000),
  enabled: z.boolean().default(true),
}).strict();
export type CreateProactiveSubscriptionInput = z.infer<typeof CreateProactiveSubscriptionSchema>;

export const PatchProactiveSubscriptionSchema = z.object({
  expectedRevision: z.number().int().positive(),
  matchPredicates: ProactiveMatchPredicatesSchema.optional(),
  defaultRoute: ProactiveRouteHintSchema.optional(),
  coalesceWindowMs: z.number().int().min(0).max(86_400_000).optional(),
  enabled: z.boolean().optional(),
}).strict();
export type PatchProactiveSubscriptionInput = z.infer<typeof PatchProactiveSubscriptionSchema>;

export interface ProactiveSubscription {
  id: string;
  ownerId: string;
  scopeType: ProactiveScopeType;
  scopeId?: string;
  sourcePattern: string;
  eventTypePattern: string;
  matchPredicates: ProactiveMatchPredicates;
  defaultRoute: ProactiveRouteHint;
  coalesceWindowMs: number;
  authority: ProactiveAuthority;
  enabled: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface CoalescedSignal {
  ownerId: string;
  coalesceKey: string;
  subscriptionId?: string;
  source: string;
  eventType: string;
  subjectKind?: string;
  subjectId?: string;
  trust: AutomationEventEnvelope['trust'];
  latestEventId: string;
  eventIds: string[];
  eventCount: number;
  payload: Record<string, unknown>;
  contentFingerprint: string;
  routeHint: ProactiveRouteHint;
  windowStartedAt: number;
  flushAfter: number;
  status: 'buffering' | 'processing' | 'triaged' | 'dropped';
  leaseToken?: string;
  leaseUntil: number;
  updatedAt: number;
}

export interface ProactiveTriageScore {
  actionability: 0 | 1 | 2 | 3;
  urgency: 0 | 1 | 2 | 3;
  novelty: 0 | 1 | 2;
  preparedness: 0 | 1 | 2;
  disruptionPenalty: number;
  netScore: number;
}

export interface ProactiveProposedAction {
  kind: 'approve_draft' | 'create_task' | 'adopt_rsi_candidate' | 'acknowledge';
  safetyMode: 'ask_before_apply';
  label: string;
  targetRef?: string;
  parameters?: Record<string, unknown>;
}

export interface PreparedScoutPackage {
  verifiedFacts: string[];
  evidenceRefs: string[];
  preparedDraft?: string;
  proposedAction?: ProactiveProposedAction;
}

export interface ProactiveProvenance {
  source: string;
  eventType: string;
  trust: AutomationEventEnvelope['trust'];
  coalescedCount: number;
  subscriptionId?: string;
  matchedProjectId?: string;
  matchedThreadId?: string;
  reason: string;
  evidenceRefs: string[];
  score: ProactiveTriageScore;
}

export const ProactiveItemResolutionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    idempotencyKey: z.string().trim().min(1).max(200),
    note: z.string().trim().max(2000).optional(),
  }).strict(),
  z.object({
    action: z.literal('edit_and_approve'),
    idempotencyKey: z.string().trim().min(1).max(200),
    editedDraft: z.string().trim().min(1).max(20_000),
    note: z.string().trim().max(2000).optional(),
  }).strict(),
  z.object({
    action: z.literal('move_to_digest'),
    idempotencyKey: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({
    action: z.literal('snooze'),
    idempotencyKey: z.string().trim().min(1).max(200),
    untilMs: z.number().int().positive(),
  }).strict(),
  z.object({
    action: z.literal('mute_rule'),
    idempotencyKey: z.string().trim().min(1).max(200),
    mode: z.enum(['drop', 'digest_only']).default('drop'),
    senderOrSubjectFilter: z.string().trim().min(1).max(320).optional(),
  }).strict(),
]);
export type ProactiveItemResolutionInput = z.infer<typeof ProactiveItemResolutionSchema>;

export interface ProactiveHumanResolution {
  action: ProactiveItemResolutionInput['action'];
  idempotencyKey: string;
  resolvedAt: number;
  originalDraft?: string;
  editedDraft?: string;
  muteMode?: 'drop' | 'digest_only';
  senderOrSubjectFilter?: string;
  note?: string;
}

export interface ProactiveItem {
  id: string;
  ownerId: string;
  agentId: string;
  coalesceKey: string;
  sourceEventIds: string[];
  tier: ProactiveTier;
  category: ProactiveCategory;
  title: string;
  summary: string;
  provenance: ProactiveProvenance;
  preparedPayload?: PreparedScoutPackage;
  proposedAction?: ProactiveProposedAction;
  state: ProactiveItemState;
  digestBatchId?: string;
  conversationEntryId?: string;
  humanResolution?: ProactiveHumanResolution;
  idempotencyKey: string;
  validUntil: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProactiveHubMetrics {
  activeSubscriptions: number;
  bufferingSignals: number;
  droppedSignalsTotal: number;
  inboxPendingCount: number;
  chatEscalatedCount: number;
  digestBufferedCount: number;
  actedCount: number;
  mutedCount: number;
}
