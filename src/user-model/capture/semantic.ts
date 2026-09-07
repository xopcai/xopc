import { z } from 'zod';

import type { AssertionCandidate, AssertionAuthority } from '../domain.js';

export const USER_MODEL_CAPTURE_INTENTS = [
  'remember', 'query', 'confirm', 'correct', 'forget', 'user_assertion', 'task', 'none',
] as const;

export type UserModelCaptureIntent = typeof USER_MODEL_CAPTURE_INTENTS[number];

export interface CaptureEvidence {
  ref: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}

export interface ParsedAssertionCandidate extends AssertionCandidate {
  evidenceRefs: string[];
  temporalResolution: 'exact' | 'relative_resolved' | 'unresolved';
  originalTimePhrase?: string;
}

export interface UserModelInterpretation {
  intent: UserModelCaptureIntent;
  candidates: ParsedAssertionCandidate[];
  targetAssertionIds: string[];
  abstentionReason?: string;
}

const ScopeSchema = z.object({
  type: z.enum(['global', 'agent', 'workspace', 'project', 'session']),
  id: z.string().min(1).optional(),
}).strict().superRefine((scope, ctx) => {
  if (scope.type === 'global' && scope.id) ctx.addIssue({ code: 'custom', message: 'Global scope has no id.' });
  if (scope.type !== 'global' && !scope.id) ctx.addIssue({ code: 'custom', message: `${scope.type} scope needs an id.` });
});

const CandidateSchema = z.object({
  subject: z.object({
    type: z.enum(['user', 'person', 'goal', 'project', 'topic']),
    id: z.string().min(1).max(160),
  }).strict(),
  predicate: z.string().regex(/^[a-z][a-z0-9_.-]{2,119}$/),
  cardinality: z.enum(['single', 'multiple']),
  scope: ScopeSchema,
  kind: z.enum([
    'identity', 'preference', 'value', 'routine', 'capability',
    'relationship', 'current_state', 'derived_insight',
  ]),
  value: z.unknown(),
  normalizedValue: z.string().min(1).max(600),
  statement: z.string().min(4).max(600),
  authority: z.enum(['user_explicit', 'user_observed', 'system_inferred', 'external_untrusted']),
  confidence: z.number().min(0).max(1),
  declaredImportance: z.number().min(0).max(1).optional(),
  inferredImportance: z.number().min(0).max(1),
  consequence: z.enum(['low', 'medium', 'high', 'critical']),
  actionability: z.number().min(0).max(1),
  volatility: z.enum(['stable', 'slow', 'dynamic', 'event']),
  sensitivity: z.enum(['normal', 'personal', 'secret', 'regulated']),
  disclosurePolicy: z.enum(['silent', 'referenceable', 'ask_before_reference']),
  applicability: z.record(z.string(), z.unknown()).default({}),
  validFrom: z.string().datetime({ offset: true }).optional(),
  validTo: z.string().datetime({ offset: true }).optional(),
  reviewAt: z.string().datetime({ offset: true }).optional(),
  temporalResolution: z.enum(['exact', 'relative_resolved', 'unresolved']),
  originalTimePhrase: z.string().max(200).optional(),
  correctionOfAssertionId: z.string().min(1).optional(),
  evidence: z.array(z.object({ ref: z.string().min(1), quote: z.string().min(1) }).strict()).min(1).max(8),
  selfContained: z.boolean(),
  unresolvedReferences: z.array(z.string()).max(8),
}).strict();

const InterpretationSchema = z.object({
  intent: z.enum(USER_MODEL_CAPTURE_INTENTS),
  candidates: z.array(CandidateSchema).max(8),
  targetAssertionIds: z.array(z.string().min(1)).max(8),
  abstentionReason: z.string().max(500).optional(),
}).strict();

function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return JSON.parse(fenced ?? (start >= 0 && end > start ? raw.slice(start, end + 1) : raw));
}

function comparable(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function effectiveAuthority(intent: UserModelCaptureIntent, authority: AssertionAuthority): AssertionAuthority {
  if (intent === 'remember' || intent === 'correct' || intent === 'confirm') return authority;
  return authority === 'user_explicit' ? 'user_observed' : authority;
}

function parseTime(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Date.parse(value);
}

export function parseUserModelInterpretation(
  raw: string,
  evidence: CaptureEvidence[],
  allowedTargetIds: string[] = [],
): UserModelInterpretation | null {
  let parsed: z.infer<typeof InterpretationSchema>;
  try {
    const result = InterpretationSchema.safeParse(extractJson(raw));
    if (!result.success) return null;
    parsed = result.data;
  } catch {
    return null;
  }
  const evidenceByRef = new Map(evidence.map((item) => [item.ref, item]));
  const candidateIntents = new Set<UserModelCaptureIntent>(['remember', 'correct', 'confirm', 'user_assertion']);
  const candidates: ParsedAssertionCandidate[] = [];
  if (candidateIntents.has(parsed.intent)) {
    for (const item of parsed.candidates) {
      if (!item.selfContained || item.unresolvedReferences.length) continue;
      const grounded = item.evidence.every((claim) => {
        const source = evidenceByRef.get(claim.ref);
        return source?.role === 'user' && comparable(source.text).includes(comparable(claim.quote));
      });
      if (!grounded) continue;
      const observedAt = Math.max(...item.evidence.map((claim) => evidenceByRef.get(claim.ref)!.createdAt));
      candidates.push({
        subject: item.subject,
        predicate: item.predicate,
        cardinality: item.cardinality,
        scope: item.scope,
        kind: item.kind,
        value: item.value,
        normalizedValue: item.normalizedValue,
        statement: item.statement,
        authority: effectiveAuthority(parsed.intent, item.authority),
        confidence: item.confidence,
        ...(item.declaredImportance === undefined ? {} : { declaredImportance: item.declaredImportance }),
        inferredImportance: item.inferredImportance,
        consequence: item.consequence,
        actionability: item.actionability,
        volatility: item.volatility,
        sensitivity: item.sensitivity,
        disclosurePolicy: item.disclosurePolicy,
        applicability: item.applicability,
        ...(item.temporalResolution === 'unresolved' ? {} : {
          ...(item.validFrom ? { validFrom: parseTime(item.validFrom) } : {}),
          ...(item.validTo ? { validTo: parseTime(item.validTo) } : {}),
          ...(item.reviewAt ? { reviewAt: parseTime(item.reviewAt) } : {}),
        }),
        temporalResolution: item.temporalResolution,
        ...(item.originalTimePhrase ? { originalTimePhrase: item.originalTimePhrase } : {}),
        ...(item.correctionOfAssertionId && allowedTargetIds.includes(item.correctionOfAssertionId)
          ? { correctionOfAssertionId: item.correctionOfAssertionId }
          : {}),
        observedAt,
        createdBy: 'runtime',
        evidenceRefs: [...new Set(item.evidence.map((claim) => claim.ref))],
      });
    }
  }
  const allowed = new Set(allowedTargetIds);
  return {
    intent: parsed.intent,
    candidates,
    targetAssertionIds: [...new Set(parsed.targetAssertionIds.filter((id) => allowed.has(id)))],
    ...(parsed.abstentionReason ? { abstentionReason: parsed.abstentionReason } : {}),
  };
}
