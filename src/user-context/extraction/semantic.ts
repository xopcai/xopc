import { z } from 'zod';

import type { UnderstandingCandidate } from '../../agent/memory/understanding/types.js';
import { inferMemorySensitivity } from '../../agent/memory/sensitivity.js';
import { UNDERSTANDING_KINDS, type UserUnderstanding } from '../domain.js';
import { isDurableUnderstandingCandidate } from '../understandingQuality.js';

export const UNDERSTANDING_INTENTS = [
  'memory_create', 'memory_query', 'memory_confirm', 'memory_correct',
  'memory_forget', 'user_assertion', 'task_request', 'none',
] as const;

export type UnderstandingIntent = typeof UNDERSTANDING_INTENTS[number];

export type SemanticEvidence = {
  ref: string;
  role: 'user' | 'assistant';
  text: string;
};

export type SemanticUnderstandingCandidate = UnderstandingCandidate & {
  evidenceRefs: string[];
};

export type SemanticUnderstandingInterpretation = {
  intent: UnderstandingIntent;
  candidates: SemanticUnderstandingCandidate[];
  targetUnderstandingIds: string[];
  abstentionReason?: string;
};

const EvidenceSchema = z.object({
  ref: z.string().min(1),
  quote: z.string().min(1),
}).strict();

const CandidateSchema = z.object({
  factKey: z.string().regex(/^[a-z0-9][a-z0-9:-]{2,119}$/),
  statement: z.string().min(4).max(600),
  kind: z.enum(UNDERSTANDING_KINDS),
  explicitness: z.enum(['explicit', 'observed', 'inferred']),
  durability: z.enum(['ephemeral', 'durable', 'recurring']),
  scopeHint: z.enum(['global', 'workspace', 'project', 'session']),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  sensitivity: z.enum(['normal', 'personal', 'secret', 'regulated']).optional(),
  disclosurePolicy: z.enum(['silent', 'referenceable', 'ask_before_reference']).optional(),
  evidence: z.array(EvidenceSchema).min(1).max(8),
  selfContained: z.boolean(),
  unresolvedReferences: z.array(z.string()).max(8),
}).strict();

const InterpretationSchema = z.object({
  intent: z.enum(UNDERSTANDING_INTENTS),
  candidates: z.array(CandidateSchema).max(8),
  targetUnderstandingIds: z.array(z.string().min(1)).max(8),
  abstentionReason: z.string().max(500).optional(),
}).strict();

const CANDIDATE_INTENTS = new Set<UnderstandingIntent>([
  'memory_create', 'memory_confirm', 'memory_correct', 'user_assertion',
]);
const QUESTION_END = /[?？]\s*$/u;

function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const candidate = fenced ?? (start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  return JSON.parse(candidate);
}

function comparableText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function quoteIsGrounded(quote: string, source: string): boolean {
  return comparableText(source).includes(comparableText(quote));
}

function bigramSimilarity(left: string, right: string): number {
  const pairs = (value: string): Set<string> => {
    const normalized = comparableText(value).replace(/[^\p{L}\p{N}]/gu, '');
    const output = new Set<string>();
    for (let index = 0; index < normalized.length - 1; index += 1) output.add(normalized.slice(index, index + 2));
    return output;
  };
  const a = pairs(left);
  const b = pairs(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const pair of a) if (b.has(pair)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function effectiveExplicitness(
  intent: UnderstandingIntent,
  declared: UserUnderstanding['explicitness'],
): UserUnderstanding['explicitness'] {
  if (intent === 'memory_create' || intent === 'memory_correct' || intent === 'memory_confirm') {
    return declared;
  }
  return declared === 'explicit' ? 'observed' : declared;
}

export function parseSemanticUnderstanding(
  raw: string,
  evidence: SemanticEvidence[],
  allowedTargetIds: string[] = [],
): SemanticUnderstandingInterpretation | null {
  let parsed: z.infer<typeof InterpretationSchema>;
  try {
    const result = InterpretationSchema.safeParse(extractJson(raw));
    if (!result.success) return null;
    parsed = result.data;
  } catch {
    return null;
  }

  const evidenceByRef = new Map(evidence.map((item) => [item.ref, item]));
  const allowedTargets = new Set(allowedTargetIds);
  const candidates: SemanticUnderstandingCandidate[] = [];
  if (CANDIDATE_INTENTS.has(parsed.intent)) {
    for (const item of parsed.candidates) {
      if (!item.selfContained || item.unresolvedReferences.length > 0) continue;
      if (QUESTION_END.test(item.statement)) continue;
      if (!isDurableUnderstandingCandidate(item.kind, item.statement)) continue;
      const grounded = item.evidence.every((claim) => {
        const source = evidenceByRef.get(claim.ref);
        return source?.role === 'user' && quoteIsGrounded(claim.quote, source.text);
      });
      if (!grounded) continue;
      if (item.explicitness === 'explicit') {
        const quotedText = item.evidence.map((claim) => claim.quote).join(' ');
        if (bigramSimilarity(item.statement, quotedText) < 0.45) continue;
      }
      const evidenceRefs = [...new Set(item.evidence.map((claim) => claim.ref))];
      candidates.push({
        kind: item.kind,
        content: item.statement.trim(),
        canonicalKey: `understanding:${item.kind}:${item.factKey}`,
        confidence: item.confidence,
        importance: item.importance,
        explicitness: effectiveExplicitness(parsed.intent, item.explicitness),
        durability: item.durability,
        sensitivity: item.sensitivity ?? inferMemorySensitivity(item.statement),
        disclosurePolicy: item.disclosurePolicy ?? 'referenceable',
        payload: { scopeHint: item.scopeHint },
        evidenceRefs,
      });
    }
  }

  return {
    intent: parsed.intent,
    candidates,
    targetUnderstandingIds: [...new Set(parsed.targetUnderstandingIds.filter((id) => allowedTargets.has(id)))],
    ...(parsed.abstentionReason ? { abstentionReason: parsed.abstentionReason } : {}),
  };
}
