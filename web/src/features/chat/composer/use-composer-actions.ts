import { useCallback, useRef } from 'react';

import type { ComposerContextRef, ComposerDraft, WireAttachment } from '@/features/chat/composer/composer.types';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { MAX_PENDING_FOLLOW_UPS } from '@/features/chat/follow-up/pending-follow-up.types';
import type { PendingFollowUp } from '@/features/chat/follow-up/pending-follow-up.types';
import type { ChatMessages } from '@/i18n/messages';

/**
 * Shared guard + payload extraction for send/flush/interrupt.
 * Returns null if voice is recording (stops it) or if the draft is empty.
 */
function harvestDraft(opts: {
  voiceActive: boolean;
  cancelVoiceInput: () => void;
  getTextValue: () => string;
  getAttachmentCount: () => number;
  wireAttachmentsPayload: () => WireAttachment[];
  getContextRefs: () => ComposerContextRef[];
}): ComposerDraft | null {
  if (opts.voiceActive) {
    opts.cancelVoiceInput();
    return null;
  }

  const text = opts.getTextValue();
  if (!text.trim() && opts.getAttachmentCount() === 0) return null;

  const wirePayload = opts.wireAttachmentsPayload();
  return {
    text,
    attachments: wirePayload,
    contextRefs: opts.getContextRefs(),
  };
}

export interface UseComposerActionsOptions {
  chat: ChatMessages;
  runBusy: boolean;
  voiceActive: boolean;
  cancelVoiceInput: () => void;
  editingFollowUpId: string | null;

  getTextValue: () => string;
  getAttachmentCount: () => number;
  wireAttachmentsPayload: () => WireAttachment[];
  getContextRefs: () => ComposerContextRef[];
  getThinkingLevel: () => string;

  onSend: (text: string, attachments?: WireAttachment[], thinkingLevel?: string, contextRefs?: ComposerContextRef[]) => void;
  onAddPendingFollowUp?: (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[]) => void | Promise<void>;
  onSteeringInterrupt?: (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[]) => void;
  onCommitEditFollowUp: (
    id: string,
    text: string,
    attachments?: PendingFollowUp['attachments'],
    thinkingLevel?: string,
    contextRefs?: ComposerContextRef[],
  ) => void;
  onPendingFollowUpRemove: (id: string) => void;
  pendingFollowUpsCount: number;

  resetEditor: () => void;
  clearAttachments: () => void;
  clearContextRefs: () => void;
  clearEditFollowUpRef: () => void;
  /** After a draft is committed (send, queue, interrupt); used for input history. */
  onUserTextCommitted?: (text: string) => void;
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
    voiceActive,
    cancelVoiceInput,
    editingFollowUpId,
    getTextValue,
    getAttachmentCount,
    wireAttachmentsPayload,
    getContextRefs,
    getThinkingLevel,
    onSend,
    onAddPendingFollowUp,
    onSteeringInterrupt,
    onCommitEditFollowUp,
    onPendingFollowUpRemove,
    pendingFollowUpsCount,
    resetEditor,
    clearAttachments,
    clearContextRefs,
    clearEditFollowUpRef,
    onUserTextCommitted,
  } = options;

  const readers = {
    getTextValue,
    getAttachmentCount,
    wireAttachmentsPayload,
    getContextRefs,
  };
  const followUpSubmissionRef = useRef(false);

  const send = useCallback(() => {
    if (runBusy) return;
    const draft = harvestDraft({
      voiceActive,
      cancelVoiceInput,
      ...readers,
    });
    if (!draft) return;

    onSend(
      draft.text,
      draft.attachments.length > 0 ? draft.attachments : undefined,
      getThinkingLevel(),
      draft.contextRefs.length > 0 ? draft.contextRefs : undefined,
    );
    onUserTextCommitted?.(draft.text);
    resetEditor();
    clearAttachments();
    clearContextRefs();
  }, [
    runBusy,
    voiceActive,
    cancelVoiceInput,
    onSend,
    getThinkingLevel,
    onUserTextCommitted,
    resetEditor,
    clearAttachments,
    clearContextRefs,
    getTextValue,
    getAttachmentCount,
    wireAttachmentsPayload,
    getContextRefs,
  ]);

  const flushSteeringDraft = useCallback(async () => {
    if (!runBusy && pendingFollowUpsCount === 0) return;
    const draft = harvestDraft({
      voiceActive,
      cancelVoiceInput,
      ...readers,
    });
    if (!draft) return;

    if (editingFollowUpId) {
      onCommitEditFollowUp(
        editingFollowUpId,
        draft.text,
        draft.attachments.length > 0 ? draft.attachments : undefined,
        getThinkingLevel(),
        draft.contextRefs.length > 0 ? draft.contextRefs : undefined,
      );
      onUserTextCommitted?.(draft.text);
      clearEditFollowUpRef();
      resetEditor();
      clearAttachments();
      clearContextRefs();
      return;
    }

    if (!onAddPendingFollowUp) return;
    if (followUpSubmissionRef.current) return;
    if (pendingFollowUpsCount >= MAX_PENDING_FOLLOW_UPS) {
      showComposerNotification('warning', m.followUpQueueMaxReached, { max: MAX_PENDING_FOLLOW_UPS });
      return;
    }

    followUpSubmissionRef.current = true;
    try {
      await onAddPendingFollowUp(
        draft.text,
        draft.attachments.length > 0 ? draft.attachments : undefined,
        draft.contextRefs.length > 0 ? draft.contextRefs : undefined,
      );
      onUserTextCommitted?.(draft.text);
      resetEditor();
      clearAttachments();
      clearContextRefs();
    } catch (error) {
      showComposerNotification('error', m.followUpQueueSubmitFailed, {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      followUpSubmissionRef.current = false;
    }
  }, [
    runBusy,
    voiceActive,
    cancelVoiceInput,
    editingFollowUpId,
    pendingFollowUpsCount,
    onAddPendingFollowUp,
    onCommitEditFollowUp,
    getThinkingLevel,
    m.followUpQueueMaxReached,
    m.followUpQueueSubmitFailed,
    clearEditFollowUpRef,
    onUserTextCommitted,
    resetEditor,
    clearAttachments,
    clearContextRefs,
    getTextValue,
    getAttachmentCount,
    wireAttachmentsPayload,
    getContextRefs,
  ]);

  const interruptDraft = useCallback(() => {
    if (!runBusy || !onSteeringInterrupt) return;
    const draft = harvestDraft({
      voiceActive,
      cancelVoiceInput,
      ...readers,
    });
    if (!draft) return;

    onSteeringInterrupt(
      draft.text,
      draft.attachments.length > 0 ? draft.attachments : undefined,
      draft.contextRefs.length > 0 ? draft.contextRefs : undefined,
    );
    onUserTextCommitted?.(draft.text);

    if (editingFollowUpId) {
      clearEditFollowUpRef();
      onPendingFollowUpRemove(editingFollowUpId);
    }

    resetEditor();
    clearAttachments();
    clearContextRefs();
  }, [
    runBusy,
    voiceActive,
    cancelVoiceInput,
    editingFollowUpId,
    onPendingFollowUpRemove,
    onSteeringInterrupt,
    onUserTextCommitted,
    clearEditFollowUpRef,
    resetEditor,
    clearAttachments,
    clearContextRefs,
    getTextValue,
    getAttachmentCount,
    wireAttachmentsPayload,
    getContextRefs,
  ]);

  return { send, flushSteeringDraft, interruptDraft };
}
