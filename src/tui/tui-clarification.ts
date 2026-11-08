import { randomUUID } from 'node:crypto';

import { normalizeClarificationSubmission, type ClarificationPresentation, type ClarificationResponseCommand } from '@xopcai/gateway-contract';

export type TuiClarification = ClarificationPresentation & {
  id: string;
  conversationId: string;
  version: number;
  kind: 'input' | 'approval';
  question: string;
  expiresAt?: number;
};

export interface TuiClarificationDialogs {
  choose(title: string, options: string[]): Promise<string | undefined>;
  input(title: string): Promise<string | undefined>;
}

/** Collect structured answers; plain chat and steering never grant approval. */
export async function collectTuiClarification(
  request: TuiClarification,
  dialogs: TuiClarificationDialogs,
): Promise<ClarificationResponseCommand> {
  const base = { expectedVersion: request.version, idempotencyKey: randomUUID() };
  const cancel = { ...base, action: 'cancel' as const };
  if (request.expiresAt !== undefined && request.expiresAt <= Date.now()) throw new Error('This question or approval has expired.');
  if (request.kind === 'approval') {
    const approval = request.approval;
    if (!approval) throw new Error('The approval is missing its operation details.');
    const choice = await dialogs.choose([request.question, approval.operation, approval.target, approval.impact,
      approval.argumentsPreview ? JSON.stringify(approval.argumentsPreview, null, 2) : undefined].filter(Boolean).join('\n'), ['Deny', 'Approve this operation']);
    if (!choice) return cancel;
    return { ...base, action: 'answer', decision: choice === 'Approve this operation' ? 'approve' : 'deny' };
  }
  if (request.schemaVersion === 2 && request.questions) {
    const answers = [];
    for (const question of request.questions) {
      if (question.type === 'text') {
        const text = await dialogs.input(`${question.header}\n${question.question}`);
        if (text === undefined) return cancel;
        answers.push({ questionId: question.id, text });
      } else {
        const labels = question.choices.map((choice, i) => `${i + 1}. ${choice.label}${choice.id === question.recommendedChoiceId ? ' (recommended)' : ''}${choice.description ? ` — ${choice.description}` : ''}`);
        const chosen = await dialogs.choose(`${question.header}\n${question.question}`, [...labels, 'Write an answer']);
        if (!chosen) return cancel;
        const index = labels.indexOf(chosen);
        if (index >= 0) answers.push({ questionId: question.id, choiceId: question.choices[index]!.id });
        else {
          const text = await dialogs.input(question.question);
          if (text === undefined) return cancel;
          answers.push({ questionId: question.id, text });
        }
      }
    }
    const normalized = normalizeClarificationSubmission(request, { schemaVersion: 2, answers });
    return { ...base, action: 'answer', schemaVersion: 2, answers: normalized.answers };
  }
  const choices = request.choiceDetails ?? [];
  const labels = choices.map((choice, i) => `${i + 1}. ${choice.label}${choice.id === request.recommendedChoiceId ? ' (recommended)' : ''}${choice.description ? ` — ${choice.description}` : ''}`);
  const selected = labels.length ? await dialogs.choose(request.question, [...labels, 'Write an answer']) : 'Write an answer';
  if (!selected) return cancel;
  const index = labels.indexOf(selected);
  const choiceId = index >= 0 ? choices[index]!.id : undefined;
  const text = !choiceId || request.interactionMode === 'compose'
    ? await dialogs.input(choiceId ? `${request.question}\nAdditional information (optional)` : request.question) : undefined;
  if ((!choiceId || request.interactionMode === 'compose') && text === undefined) return cancel;
  const normalized = normalizeClarificationSubmission(request, { response: { choiceId, text } });
  return { ...base, action: 'answer', response: normalized.response };
}
