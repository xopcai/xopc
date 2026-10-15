import { z } from 'zod';

export type ClarificationKind = 'input' | 'approval';
export type ClarificationStatus =
  | 'open'
  | 'queued'
  | 'resolved'
  | 'expired'
  | 'cancelled'
  | 'superseded';
export type ClarificationResolution = 'answered' | 'agent_decide' | 'cancelled';

export type ClarificationCheckpoint = {
  transcriptEntryId?: string;
  objectiveSummary: string;
  completedSteps: string[];
  pendingSteps: string[];
  originalRequestAt: number;
};

export type ClarificationWait = ClarificationPresentation & {
  id: string;
  principalId: string;
  conversationId: string;
  transcriptId: string;
  objectiveId: string;
  objectiveRevision: number;
  originRunId: string;
  originInputId: string;
  originToolCallId: string;
  taskRunId?: string;
  kind: ClarificationKind;
  status: ClarificationStatus;
  question: string;
  checkpoint: ClarificationCheckpoint;
  answer?: string;
  response?: ClarificationAnswer;
  decision?: ClarificationDecision;
  resolution?: ClarificationResolution;
  expiresAt?: number;
  approvalKey?: string;
  approvalConsumedAt?: number;
  responseIdempotencyKey?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
};

export type ClarificationWaitSnapshot = {
  transcriptId: string;
  revision: number;
  serverTime: number;
  clarification: ClarificationWait | null;
};

export type ClarificationResponseAction = 'answer' | 'agent_decide' | 'cancel';

export const CLARIFICATION_ANSWER_LIMIT = 8_000;
export const clarificationPresentationSchema = z.object({
  interactionMode: z.enum(['quick', 'compose']).optional(),
  choiceDetails: z.array(z.object({
    id: z.string().min(1).max(160),
    label: z.string().trim().min(1).max(1_000),
    description: z.string().max(2_000).optional(),
  }).strict()).min(2).max(10).optional(),
  recommendedChoiceId: z.string().min(1).max(160).optional(),
  approval: z.object({
    operation: z.string().min(1).max(1_000),
    target: z.string().max(2_000).optional(),
    impact: z.string().max(4_000).optional(),
    argumentsPreview: z.record(z.string(), z.unknown()).optional(),
  }).strict().optional(),
});
export type ClarificationPresentation = z.infer<typeof clarificationPresentationSchema>;
export const clarificationSubmissionSchema = z.object({
  response: z.object({
    choiceId: z.string().min(1).max(160).optional(),
    text: z.string().trim().max(CLARIFICATION_ANSWER_LIMIT).optional(),
  }).strict().optional(),
  decision: z.enum(['approve', 'deny']).optional(),
}).strict();
export const clarificationResponseCommandSchema = clarificationSubmissionSchema.extend({
  action: z.enum(['answer', 'agent_decide', 'cancel']),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(1).max(256),
}).strict();
export type ClarificationResponseCommand = z.infer<typeof clarificationResponseCommandSchema>;
export type ClarificationSubmission = z.infer<typeof clarificationSubmissionSchema>;
export type ClarificationAnswer = NonNullable<ClarificationSubmission['response']>;
export type ClarificationDecision = NonNullable<ClarificationSubmission['decision']>;

type Question = ClarificationPresentation & { kind?: ClarificationKind };

/** Read presentation fields from a snapshot or event envelope. */
export function readClarificationPresentation(value: unknown): ClarificationPresentation {
  const parsed = clarificationPresentationSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

/** Validate structured choices before persisting or publishing a request. */
export function normalizeClarificationQuestion<T extends Question>(question: T): T {
  if ('choices' in question || 'suggestedAnswer' in question) throw new Error('Unsupported clarification fields');
  const fields = clarificationPresentationSchema.parse(question);
  if (fields.choiceDetails && new Set(fields.choiceDetails.map(choice => choice.id)).size !== fields.choiceDetails.length) {
    throw new Error('Duplicate clarification choice IDs');
  }
  const next = { ...question, ...fields };
  if (fields.recommendedChoiceId && !next.choiceDetails?.some(choice => choice.id === fields.recommendedChoiceId)) {
    throw new Error('Invalid recommended choice');
  }
  if (fields.approval && question.kind !== 'approval') throw new Error('Approval metadata requires an approval');
  if (question.kind === 'approval' && !fields.approval) throw new Error('Approval details are required');
  return next;
}

/** Canonicalize answers on the host; never trust a submitted option label. */
export function normalizeClarificationSubmission(question: Question, raw: unknown): ClarificationSubmission & { answer: string } {
  const input = clarificationSubmissionSchema.parse(raw);
  if (question.kind === 'approval') {
    if (input.response || !input.decision) throw new Error('An explicit approval decision is required');
    return { answer: input.decision, decision: input.decision };
  }
  if (input.decision || !input.response) throw new Error('A structured response is required');
  const choice = input.response.choiceId
    ? question.choiceDetails?.find(item => item.id === input.response!.choiceId) : undefined;
  if (input.response.choiceId && !choice) throw new Error('Unknown clarification choice');
  const text = input.response.text?.trim() ?? '';
  if (!choice && !text) throw new Error('Answer is required');
  const answer = choice && text ? `Choice: ${choice.label}\nAdditional information: ${text}` : choice?.label ?? text;
  return { answer, response: { ...(choice ? { choiceId: choice.id } : {}), ...(text ? { text } : {}) } };
}
