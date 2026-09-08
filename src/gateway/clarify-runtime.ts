export type ClarificationChannelRuntime = {
  answerChoice(requestId: string, choiceIndex: number, idempotencyKey: string): boolean;
  answerText(sessionKey: string, text: string, idempotencyKey: string): boolean;
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
  sessionKey: string,
  text: string,
  idempotencyKey: string,
): boolean {
  return runtime?.answerText(sessionKey, text, idempotencyKey) ?? false;
}
