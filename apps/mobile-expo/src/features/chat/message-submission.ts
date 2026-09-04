import type { WireAttachment, WireContextRef } from './composer.types';

/** One explicit send attempt, retained by its message for manual retry. */
export type MessageSubmission = {
  clientMessageId: string;
  gatewayId: string;
  sessionKey: string;
  expectedSessionId?: string;
  taskId?: string;
  content: string;
  attachments: WireAttachment[];
  contextRefs: WireContextRef[];
};
