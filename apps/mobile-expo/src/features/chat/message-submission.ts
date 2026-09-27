import type { WireAttachment, WireContextRef } from './composer.types';
import type { SessionCreation } from '@xopcai/gateway-contract';

/** One explicit send attempt, retained by its message for manual retry. */
export type MessageSubmission = {
  clientMessageId: string;
  gatewayId: string;
  conversationId: string;
  expectedTranscriptId?: string;
  configVersion?: number;
  creation?: SessionCreation;
  taskId?: string;
  content: string;
  delivery: 'next' | 'steer';
  attachments: WireAttachment[];
  contextRefs: WireContextRef[];
};
