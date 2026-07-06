import { useCallback } from 'react';

import type { WireAttachment } from './composer.types';
import { MAX_PENDING_FOLLOW_UPS, type PendingFollowUp } from './pending-follow-up.types';
import type { MessageBundle } from '../../i18n/messages';

function harvestDraft(opts: {
  voiceRecording: boolean;
  stopVoiceRecording: () => void;
  getTextValue: () => string;
  getAttachmentCount: () => number;
  wireAttachmentsPayload: () => WireAttachment[];
}): { text: string; attachments: WireAttachment[] } | null {
  if (opts.voiceRecording) {
    opts.stopVoiceRecording();
    return null;
  }

  const text = opts.getTextValue();
  if (!text.trim() && opts.getAttachmentCount() === 0) return null;

  const wirePayload = opts.wireAttachmentsPayload();
  return { text, attachments: wirePayload };
}

export interface UseComposerActionsOptions {
  chat: MessageBundle['chat'];
  runBusy: boolean;
  voiceRecording: boolean;
  stopVoiceRecording: () => void;
  editingFollowUpId: string | null;
  getTextValue: () => string;
  getAttachmentCount: () => number;
  wireAttachmentsPayload: () => WireAttachment[];
  onSend: (text: string, attachments?: WireAttachment[]) => void | Promise<void>;
  onAddPendingFollowUp?: (text: string, attachments?: WireAttachment[]) => void | Promise<void>;
  onCommitEditFollowUp: (
    id: string,
    text: string,
    attachments?: PendingFollowUp['attachments'],
  ) => void;
  onQueueFull?: () => void;
  pendingFollowUpsCount: number;
  resetEditor: () => void;
  clearAttachments: () => void;
  clearEditFollowUpRef: () => void;
}

export function useComposerActions(options: UseComposerActionsOptions) {
  const {
    chat: m,
    runBusy,
    voiceRecording,
    stopVoiceRecording,
    editingFollowUpId,
    getTextValue,
    getAttachmentCount,
    wireAttachmentsPayload,
    onSend,
    onAddPendingFollowUp,
    onCommitEditFollowUp,
    onQueueFull,
    pendingFollowUpsCount,
    resetEditor,
    clearAttachments,
    clearEditFollowUpRef,
  } = options;

  const readers = {
    getTextValue,
    getAttachmentCount,
    wireAttachmentsPayload,
  };

  const send = useCallback(() => {
    if (runBusy) return;
    const draft = harvestDraft({ voiceRecording, stopVoiceRecording, ...readers });
    if (!draft) return;

    void onSend(
      draft.text,
      draft.attachments.length > 0 ? draft.attachments : undefined,
    );
    resetEditor();
    clearAttachments();
  }, [
    runBusy,
    voiceRecording,
    stopVoiceRecording,
    onSend,
    resetEditor,
    clearAttachments,
    getTextValue,
    getAttachmentCount,
    wireAttachmentsPayload,
  ]);

  const flushSteeringDraft = useCallback(async () => {
    if (!runBusy && pendingFollowUpsCount === 0) return;
    const draft = harvestDraft({ voiceRecording, stopVoiceRecording, ...readers });
    if (!draft) return;

    if (editingFollowUpId) {
      onCommitEditFollowUp(
        editingFollowUpId,
        draft.text,
        draft.attachments.length > 0 ? draft.attachments : undefined,
      );
      clearEditFollowUpRef();
      resetEditor();
      clearAttachments();
      return;
    }

    if (!onAddPendingFollowUp) return;
    if (pendingFollowUpsCount >= MAX_PENDING_FOLLOW_UPS) {
      onQueueFull?.();
      return;
    }

    await onAddPendingFollowUp(
      draft.text,
      draft.attachments.length > 0 ? draft.attachments : undefined,
    );
    resetEditor();
    clearAttachments();
  }, [
    runBusy,
    voiceRecording,
    stopVoiceRecording,
    editingFollowUpId,
    pendingFollowUpsCount,
    onAddPendingFollowUp,
    onCommitEditFollowUp,
    onQueueFull,
    clearEditFollowUpRef,
    resetEditor,
    clearAttachments,
    getTextValue,
    getAttachmentCount,
    wireAttachmentsPayload,
    m.followUpQueueMaxReached,
  ]);

  return { send, flushSteeringDraft };
}
