import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const choice = z.strictObject({ id, label: z.string().trim().min(1).max(120), description: z.string().max(500).optional() });
const common = { id, header: z.string().trim().min(1).max(24), question: z.string().trim().min(1).max(1000) };
export const clarificationQuestionSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...common, type: z.literal('text') }),
  z.strictObject({ ...common, type: z.literal('single_choice'), choices: z.array(choice).min(2).max(10), recommendedChoiceId: id.optional() }),
]);
export const clarificationQuestionsSchema = z.array(clarificationQuestionSchema).min(1).max(3).superRefine((questions, ctx) => {
  if (new Set(questions.map(q => q.id)).size !== questions.length) ctx.addIssue({ code: 'custom', message: 'Duplicate question IDs' });
  questions.forEach((q, index) => {
    if (q.type !== 'single_choice') return;
    if (new Set(q.choices.map(c => c.id)).size !== q.choices.length) ctx.addIssue({ code: 'custom', path: [index, 'choices'], message: 'Duplicate choice IDs' });
    if (q.recommendedChoiceId && !q.choices.some(c => c.id === q.recommendedChoiceId)) ctx.addIssue({ code: 'custom', path: [index, 'recommendedChoiceId'], message: 'Unknown recommended choice' });
  });
});
export const clarificationAnswersSchema = z.array(z.strictObject({
  questionId: id, choiceId: id.optional(), text: z.string().trim().max(2000).optional(),
})).min(1).max(3);
export type ClarificationQuestion = z.infer<typeof clarificationQuestionSchema>;
export const clarifyToolInputV2Schema = z.strictObject({ schemaVersion: z.literal(2), questions: clarificationQuestionsSchema });
export type ClarificationQuestionAnswer = z.infer<typeof clarificationAnswersSchema>[number];
export const interactionCapabilitiesSchema = z.strictObject({ clarificationVersions: z.array(z.union([z.literal(1), z.literal(2)])).min(1).max(2) });
export type InteractionCapabilities = z.infer<typeof interactionCapabilitiesSchema>;
export const CLARIFICATION_VERSIONS = [1, 2] as const;

export function assertClarificationSize(value: unknown): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 32 * 1024) throw new Error('Clarification exceeds 32 KiB');
}

export function normalizeQuestionAnswers(questions: ClarificationQuestion[], raw: unknown): { answers: ClarificationQuestionAnswer[]; answer: string } {
  const submitted = clarificationAnswersSchema.parse(raw);
  assertClarificationSize(submitted);
  if (submitted.length !== questions.length || new Set(submitted.map(a => a.questionId)).size !== submitted.length
    || submitted.some(a => !questions.some(q => q.id === a.questionId))) throw new Error('Answer every question exactly once');
  const answers = questions.map(q => {
    const a = submitted.find(item => item.questionId === q.id)!;
    const text = a.text?.trim() || undefined;
    if (q.type === 'text' && a.choiceId) throw new Error(`Unexpected choice: ${q.id}`);
    if (a.choiceId && (q.type !== 'single_choice' || !q.choices.some(c => c.id === a.choiceId))) throw new Error(`Unknown choice: ${q.id}`);
    if (!a.choiceId && !text) throw new Error(`Answer required: ${q.id}`);
    return { questionId: q.id, ...(a.choiceId ? { choiceId: a.choiceId } : {}), ...(text ? { text } : {}) };
  });
  const answer = questions.map((q, index) => {
    const a = answers[index];
    const label = q.type === 'single_choice' ? q.choices.find(c => c.id === a.choiceId)?.label : undefined;
    return `${q.header}: ${q.question}\n${[label, a.text].filter(Boolean).join('\n')}`;
  }).join('\n\n');
  return { answers, answer };
}
