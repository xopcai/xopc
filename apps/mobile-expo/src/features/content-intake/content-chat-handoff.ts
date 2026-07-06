import type { ContentIntakeSource } from './content-intent';

export type ContentChatIntake = {
  sessionKey: string;
  text: string;
  prompt: string;
  source: ContentIntakeSource;
};

let pendingIntake: ContentChatIntake | null = null;

export function setContentChatIntake(intake: ContentChatIntake): void {
  pendingIntake = intake;
}

export function consumeContentChatIntake(sessionKey: string): ContentChatIntake | null {
  if (!pendingIntake || pendingIntake.sessionKey !== sessionKey) return null;
  const intake = pendingIntake;
  pendingIntake = null;
  return intake;
}
