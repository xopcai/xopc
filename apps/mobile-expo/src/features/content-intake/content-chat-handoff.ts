import type { ContentIntakeSource } from './content-intent';

export type ContentChatIntake = {
  conversationId: string;
  text: string;
  prompt: string;
  source: ContentIntakeSource;
};

let pendingIntake: ContentChatIntake | null = null;

export function setContentChatIntake(intake: ContentChatIntake): void {
  pendingIntake = intake;
}

export function consumeContentChatIntake(conversationId: string): ContentChatIntake | null {
  if (!pendingIntake || pendingIntake.conversationId !== conversationId) return null;
  const intake = pendingIntake;
  pendingIntake = null;
  return intake;
}
