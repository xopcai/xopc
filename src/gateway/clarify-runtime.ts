export type ChannelApprovalIdentity = { channel: string; accountId: string; chatId: string; senderId: string };

export type ClarificationChannelRuntime = {
  answerChoice(requestId: string, choiceIndex: number, idempotencyKey: string): boolean;
  answerDecision(requestId: string, decision: 'approve' | 'deny', idempotencyKey: string, identity?: ChannelApprovalIdentity): boolean;
  answerText(conversationId: string, text: string, idempotencyKey: string): boolean;
};

let runtime: ClarificationChannelRuntime | null = null;

export function registerClarificationChannelRuntime(next: ClarificationChannelRuntime | null): void {
  runtime = next;
}

export function answerClarificationChoiceFromChannel(
  requestId: string,
  choiceIndex: number,
  idempotencyKey: string,
): boolean {
  return runtime?.answerChoice(requestId, choiceIndex, idempotencyKey) ?? false;
}

export function answerClarificationTextFromChannel(
  conversationId: string,
  text: string,
  idempotencyKey: string,
): boolean {
  return runtime?.answerText(conversationId, text, idempotencyKey) ?? false;
}

export function answerClarificationDecisionFromChannel(requestId: string, decision: 'approve' | 'deny', idempotencyKey: string, identity?: ChannelApprovalIdentity): boolean {
  return runtime?.answerDecision(requestId, decision, idempotencyKey, identity) ?? false;
}
