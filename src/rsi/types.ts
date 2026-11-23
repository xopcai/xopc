import { z } from 'zod';

import { ProactiveMatchPredicatesSchema, ProactiveRouteHintSchema } from '../proactive-hub/types.js';

export const RsiArtifactKindSchema = z.enum(['skill', 'routine_method', 'filter_rule']);
export type RsiArtifactKind = z.infer<typeof RsiArtifactKindSchema>;

export const RsiScopeTypeSchema = z.enum(['project', 'workspace', 'agent', 'global']);
export type RsiScopeType = z.infer<typeof RsiScopeTypeSchema>;

export const RsiTriggerKindSchema = z.enum([
  'recovered_failure',
  'human_edit_diff',
  'repeated_pattern',
  'triage_mute',
]);
export type RsiTriggerKind = z.infer<typeof RsiTriggerKindSchema>;

export const SimRationaleSchema = z.object({
  problemPattern: z.string().trim().min(4).max(800),
  whyChanged: z.string().trim().min(4).max(1_200),
  applicabilityConditions: z.array(z.string().trim().min(2).max(400)).min(1).max(8),
  negativeConstraints: z.array(z.string().trim().min(2).max(400)).min(1).max(8),
  preservedInvariants: z.array(z.string().trim().min(2).max(400)).default([]),
}).strict();
export type SimRationale = z.infer<typeof SimRationaleSchema>;

export const RsiStagedPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('skill'),
    skillName: z.string().trim().min(1).max(64),
    description: z.string().trim().min(4).max(400),
    skillMarkdown: z.string().min(20).max(100_000),
  }).strict(),
  z.object({
    kind: z.literal('routine_method'),
    routineId: z.string().trim().min(1).max(120),
    additions: z.array(z.string().trim().min(2).max(600)).min(1).max(12),
  }).strict(),
  z.object({
    kind: z.literal('filter_rule'),
    sourcePattern: z.string().trim().min(1).max(160),
    eventTypePattern: z.string().trim().min(1).max(160),
    matchPredicates: ProactiveMatchPredicatesSchema,
    defaultRoute: ProactiveRouteHintSchema,
    coalesceWindowMs: z.number().int().min(0).max(86_400_000).default(180_000),
  }).strict(),
]);
export type RsiStagedPayload = z.infer<typeof RsiStagedPayloadSchema>;

export interface RsiGateDetail {
  passed: boolean;
  reasons: string[];
}

export interface RsiVerificationReport {
  overallPassed: boolean;
  verifiedAt: number;
  gateA_security: RsiGateDetail;
  gateB_capabilityPreservation: RsiGateDetail;
  gateC_scopeAndAuthority: RsiGateDetail;
}

export type RsiCandidateStatus = 'staged' | 'inbox_pending' | 'adopted' | 'rejected' | 'rolled_back';
export type RsiVerificationStatus = 'pending' | 'running' | 'passed' | 'failed';

export interface RsiCapabilityCandidate {
  id: string;
  ownerId: string;
  artifactKind: RsiArtifactKind;
  targetId: string;
  baseVersion?: number;
  scopeType: RsiScopeType;
  scopeId?: string;
  triggerKind: RsiTriggerKind;
  dedupeKey: string;
  sourceRefs: string[];
  simRationale: SimRationale;
  stagedContentUri: string;
  stagedPayload: RsiStagedPayload;
  contentHash: string;
  previousContentSnapshot?: string;
  verificationStatus: RsiVerificationStatus;
  verificationReport?: RsiVerificationReport;
  proactiveItemId?: string;
  status: RsiCandidateStatus;
  adoptedVersion?: number;
  createdAt: number;
  updatedAt: number;
}

export interface RsiCapabilityTelemetry {
  capabilityKind: RsiArtifactKind;
  targetId: string;
  version: number;
  invocations: number;
  verifiedSuccesses: number;
  failures: number;
  humanEdits: number;
  degradationAlerted: boolean;
  lastUsedAt?: number;
}
