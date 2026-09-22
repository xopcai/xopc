import type { ComposerDraft } from '@/features/chat/composer/composer.types';

export interface SendFlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SendFlightRequest {
  clientSubmissionId: string;
  messageRenderKey?: string;
  sourceRect: SendFlightRect;
  text: string;
  attachmentCount: number;
  contextCount: number;
}

export function createSendFlightRequest(
  clientSubmissionId: string,
  messageRenderKey: string | undefined,
  sourceRect: SendFlightRect,
  draft: ComposerDraft,
): SendFlightRequest {
  return {
    clientSubmissionId,
    messageRenderKey,
    sourceRect,
    text: draft.text.trim(),
    attachmentCount: draft.attachments.length,
    contextCount: draft.contextRefs.length,
  };
}
