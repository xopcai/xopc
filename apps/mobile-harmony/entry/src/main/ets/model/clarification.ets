export interface XopcClarificationChoice { id: string; label: string; description?: string; }
export interface XopcClarificationApproval { operation: string; target?: string; impact?: string; argumentsPreview?: Object; }
export interface XopcClarificationQuestion {
  id: string; header: string; question: string; type: string;
  choices?: XopcClarificationChoice[]; recommendedChoiceId?: string;
}
export interface XopcClarificationBatchAnswer { questionId: string; choiceId?: string; text?: string; }
export interface XopcClarificationDraft { index: number; answers: XopcClarificationBatchAnswer[]; pendingAction?: string; }
export interface XopcClarification {
  id: string; conversationId: string; kind: string; status: string; question: string; version: number;
  interactionMode?: string; choiceDetails?: XopcClarificationChoice[]; recommendedChoiceId?: string;
  approval?: XopcClarificationApproval; expiresAt?: number;
  schemaVersion?: number; questions?: XopcClarificationQuestion[];
}
export interface XopcClarificationAnswer { choiceId?: string; text?: string; }
export interface XopcClarificationCommand { schemaVersion?: number; answers?: XopcClarificationBatchAnswer[]; action: string; response?: XopcClarificationAnswer; decision?: string; }
export interface XopcClarificationResponse extends XopcClarificationCommand { expectedVersion: number; idempotencyKey: string; }

export function validClarificationQuestions(prompt: XopcClarification): boolean {
  const questions = prompt.questions ?? [];
  if (prompt.kind !== 'input' || questions.length < 1 || questions.length > 3) return false;
  const ids: string[] = [];
  return questions.every((question: XopcClarificationQuestion): boolean => {
    if (ids.includes(question.id)) return false;
    ids.push(question.id);
    return ['text', 'single_choice'].includes(question.type)
      && (question.type !== 'single_choice' || ((question.choices?.length ?? 0) >= 2 && (question.choices?.length ?? 0) <= 10));
  });
}

export function validClarificationAnswers(prompt: XopcClarification, answers: XopcClarificationBatchAnswer[]): boolean {
  const questions = prompt.questions ?? [];
  if (!validClarificationQuestions(prompt) || questions.length !== answers.length) return false;
  const valid = questions.every((question: XopcClarificationQuestion): boolean => {
    const matches = answers.filter((answer: XopcClarificationBatchAnswer): boolean => answer.questionId === question.id);
    const answer = matches[0];
    return matches.length === 1 && (!!answer.choiceId || !!answer.text?.trim()) && (answer.text?.trim().length ?? 0) <= 2000
      && (!answer.choiceId || (question.type === 'single_choice' && question.choices?.some((choice: XopcClarificationChoice): boolean => choice.id === answer.choiceId) === true));
  });
  if (!valid) return false;
  const summary = questions.map((question: XopcClarificationQuestion): string => {
    const answer = answers.find((entry: XopcClarificationBatchAnswer): boolean => entry.questionId === question.id);
    const label = question.choices?.find((choice: XopcClarificationChoice): boolean => choice.id === answer?.choiceId)?.label;
    const parts: string[] = [];
    if (label) parts.push(label);
    if (answer?.text?.trim()) parts.push(answer.text.trim());
    return question.header + ': ' + question.question + '\n' + parts.join('\n');
  }).join('\n\n');
  return summary.length <= 8000;
}
