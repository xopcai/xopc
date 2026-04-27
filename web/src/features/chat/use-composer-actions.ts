import { useCallback } from 'react';

import type { ComposerDraft, WireAttachment } from '@/features/chat/composer.types';
import { showComposerNotification } from '@/features/chat/composer-notifications';
import { MAX_PENDING_FOLLOW_UPS } from '@/features/chat/pending-follow-up.types';
import type { PendingFollowUp } from '@/features/chat/pending-follow-up.types';
import type { ChatMessages } from '@/i18n/messages';

/**
 * Shared guard + payload extraction for send/flush/interrupt.
 * Returns null if voice is recording (stops it) or if the draft is empty.
 */
function harvestDraft(opts: {
  voiceRecording: boolean;
  stopVoiceRecording: () => void;
  getTextValue: () => string;
  getAttachmentCount: () => number;
  wireAttachmentsPayload: () => WireAttachment[];
}): ComposerDraft | null {
  if (opts.voiceRecording) {
    opts.stopVoiceRecording();
    return null;
  }

  const text = opts.getTextValue();
  if (!text.trim() && opts.getAttachmentCount() === 0) return null;

  const wirePayload = opts.wireAttachmentsPayload();
  return {
    text,
    attachments: wirePayload,
  };
}

export interface UseComposerActionsOptions {
  chat: ChatMessages;
  runBusy: boolean;
  voiceRecording: boolean;
  stopVoiceRecording: () => void;
  editingFollowUpId: string | null;

  getTextValue: () => string;
  getAttachmentCount: () => number;
  wireAttachmentsPayload: () => WireAttachment[];
  getThinkingLevel: () => string;

  onSend: (text: string, attachments?: WireAttachment[], thinkingLevel?: string) => void;
  onAddPendingFollowUp?: (text: string, attachments?: WireAttachment[]) => void | Promise<void>;
  onSteeringInterrupt?: (text: string, attachments?: WireAttachment[]) => void;
  onCommitEditFollowUp: (
    id: string,
    text: string,
    attachments?: PendingFollowUp['attachments'],
    thinkingLevel?: string,
  ) => void;
  onPendingFollowUpRemove: (id: string) => void;
  pendingFollowUpsCount: number;

  resetEditor: () => void;
  clearAttachments: () => void;
  clearEditFollowUpRef: () => void;
}

export interface UseComposerActionsReturn {
  send: () => void;
  flushSteeringDraft: () => Promise<void>;
  interruptDraft: () => void;
}

export function useComposerActions(options: UseComposerActionsOptions): UseComposerActionsReturn {
  const {
    chat: m,
    runBusy,
    voiceRecording,
    stopVoiceRecording,
    editingFollowUpId,
    getTextValue,
    getAttachmentCount,
    wireAttachmentsPayload,
    getThinkingLevel,
    onSend,
    onAddPendingFollowUp,
    onSteeringInterrupt,
    onCommitEditFollowUp,
    onPendingFollowUpRemove,
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
    const draft = harvestDraft({
      voiceRecording,
      stopVoiceRecording,
      ...readers,
    });
    if (!draft) return;

    onSend(
      draft.text,
      draft.attachments.length > 0 ? draft.attachments : undefined,
      getThinkingLevel(),
    );
    resetEditor();
    clearAttachments();
  }, [
    runBusy,
    voiceRecording,
    stopVoiceRecording,
    onSend,
    getThinkingLevel,
    resetEditor,
    clearAttachments,
    getTextValue,
    getAttachmentCount,
    wireAttachmentsPayload,
  ]);

  const flushSteeringDraft = useCallback(async () => {
    if (!runBusy) return;
    const draft = harvestDraft({
      voiceRecording,
      stopVoiceRecording,
      ...readers,
    });
    if (!draft) return;

    if (editingFollowUpId) {
      onCommitEditFollowUp(
        editingFollowUpId,
        draft.text,
        draft.attachments.length > 0 ? draft.attachments : undefined,
        getThinkingLevel(),
      );
      clearEditFollowUpRef();
      resetEditor();
      clearAttachments();
      return;
    }

    if (!onAddPendingFollowUp) return;
    if (pendingFollowUpsCount >= MAX_PENDING_FOLLOW_UPS) {
      showComposerNotification('warning', m.followUpQueueMaxReached, { max: MAX_PENDING_FOLLOW_UPS });
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
    getThinkingLevel,
    m.followUpQueueMaxReached,
    clearEditFollowUpRef,
    resetEditor,
    clearAttachments,
    getTextValue,
    getAttachmentCount,
    wireAttachmentsPayload,
  ]);

  const interruptDraft = useCallback(() => {
    if (!runBusy || !onSteeringInterrupt) return;
    const draft = harvestDraft({
      voiceRecording,
      stopVoiceRecording,
      ...readers,
    });
    if (!draft) return;

    onSteeringInterrupt(
      draft.text,
      draft.attachments.length > 0 ? draft.attachments : undefined,
    );

    if (editingFollowUpId) {
      clearEditFollowUpRef();
      onPendingFollowUpRemove(editingFollowUpId);
    }

    resetEditor();
    clearAttachments();
  }, [
    runBusy,
    voiceRecording,
    stopVoiceRecording,
    editingFollowUpId,
    onPendingFollowUpRemove,
    onSteeringInterrupt,
    clearEditFollowUpRef,
    resetEditor,
    clearAttachments,
    getTextValue,
    getAttachmentCount,
    wireAttachmentsPayload,
  ]);

  return { send, flushSteeringDraft, interruptDraft };
}
