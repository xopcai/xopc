import type { WireAttachment, WireContextRef } from './composer.types';

/** One explicit send attempt, retained by its message for manual retry. */
export type MessageSubmission = {
  clientMessageId: string;
  gatewayId: string;
  conversationId: string;
  expectedTranscriptId?: string;
  taskId?: string;
  content: string;
  delivery: 'next' | 'steer';
  attachments: WireAttachment[];
  contextRefs: WireContextRef[];
};
