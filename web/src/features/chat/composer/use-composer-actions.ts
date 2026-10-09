import { useCallback, useRef } from 'react';

import type {
  ComposerContextRef,
  ComposerDispatchReceipt,
  ComposerDraft,
  ComposerSendHandler,
  WireAttachment,
} from '@/features/chat/composer/composer.types';
import { commitAcceptedSend } from './commit-accepted-send';
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
  const contextRefs = opts.getContextRefs();
  if (!text.trim() && opts.getAttachmentCount() === 0 && contextRefs.length === 0) return null;

  const wirePayload = opts.wireAttachmentsPayload();
  return structuredClone({
    text,
    attachments: wirePayload,
    contextRefs,
  });
}

export interface UseComposerActionsOptions {
  chat: ChatMessages;
  personal?: boolean;
  runBusy: boolean;
  voiceActive: boolean;
  cancelVoiceInput: () => void;
  editingFollowUpId: string | null;

  getTextValue: () => string;
  getAttachmentCount: () => number;
  wireAttachmentsPayload: () => WireAttachment[];
  getContextRefs: () => ComposerContextRef[];
  getThinkingLevel: () => string;

  onSend: ComposerSendHandler;
  onDispatched?: (receipt: ComposerDispatchReceipt, draft: ComposerDraft) => void;
  onAddPendingFollowUp?: (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[], interrupt?: boolean) => void | Promise<void>;
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
  flushSteeringDraft: (interrupt?: boolean) => Promise<void>;
  interruptDraft: () => void;
}

export function useComposerActions(options: UseComposerActionsOptions): UseComposerActionsReturn {
  const latestOptions = useRef(options);
  latestOptions.current = options;
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
    onDispatched,
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

    const sendArgs: Parameters<ComposerSendHandler> = [
      draft.text,
      draft.attachments.length > 0 ? draft.attachments : undefined,
      getThinkingLevel(),
      draft.contextRefs.length > 0 ? draft.contextRefs : undefined,
      { onDispatched: (receipt) => onDispatched?.(receipt, draft) },
    ];
    const result = onSend(...sendArgs);
    commitAcceptedSend(result, () => {
      onUserTextCommitted?.(draft.text);
      const latest = latestOptions.current;
      if (latest.getTextValue() !== draft.text
        || JSON.stringify(latest.wireAttachmentsPayload()) !== JSON.stringify(draft.attachments)
        || JSON.stringify(latest.getContextRefs()) !== JSON.stringify(draft.contextRefs)) return;
      resetEditor();
      clearAttachments();
      clearContextRefs();
    });
  }, [
    runBusy,
    voiceActive,
    cancelVoiceInput,
    onSend,
    onDispatched,
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

  const flushSteeringDraft = useCallback(async (interrupt = options.personal ? true : undefined) => {
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
      const args: Parameters<NonNullable<typeof onAddPendingFollowUp>> = [draft.text,
        draft.attachments.length > 0 ? draft.attachments : undefined,
        draft.contextRefs.length > 0 ? draft.contextRefs : undefined];
      if (interrupt !== undefined) args.push(interrupt);
      await onAddPendingFollowUp(...args);
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
    options.personal,
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
