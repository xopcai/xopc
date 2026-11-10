import { composerSubmitIntent } from './composer-submit-intent';
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
  editingUserTurnId?: string | null;
  blocked?: boolean;
  queuePaused?: boolean;
  draftScope?: { gatewayIdentity: string | undefined; conversationId: string | null };
  onFinishUserEdit?: () => void;
  onFinishFollowUpEdit?: () => void;

  getTextValue: () => string;
  getAttachmentCount: () => number;
  wireAttachmentsPayload: () => WireAttachment[];
  getContextRefs: () => ComposerContextRef[];
  getThinkingLevel: () => string;

  onSend: ComposerSendHandler;
  onDispatched?: (receipt: ComposerDispatchReceipt, draft: ComposerDraft) => void;
  onAddPendingFollowUp?: (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[], interrupt?: boolean, delivery?: 'next' | 'steer') => void | Promise<void>;
  onSteeringInterrupt?: (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[]) => void | boolean | Promise<void | boolean>;
  onCommitEditFollowUp: (
    id: string,
    text: string,
    attachments?: PendingFollowUp['attachments'],
    thinkingLevel?: string,
    contextRefs?: ComposerContextRef[],
  ) => void | boolean | Promise<boolean>;
  onPendingFollowUpRemove: (id: string) => void;
  pendingFollowUpsCount: number;
  firstPendingFollowUpId?: string;
  onSteerPendingFollowUp?: (id: string) => void;
  steeringPending?: boolean;

  resetEditor: () => void;
  clearAttachments: () => void;
  clearContextRefs: () => void;
  clearEditFollowUpRef: () => void;
  /** After a draft is committed (send, queue, interrupt); used for input history. */
  onUserTextCommitted?: (text: string, conversationId?: string) => void;
}

export interface UseComposerActionsReturn {
  send: () => void;
  flushSteeringDraft: (interrupt?: boolean, delivery?: 'next' | 'steer') => Promise<void>;
  interruptDraft: () => void;
  steerCurrentReply: () => void;
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
  const interruptSubmissionRef = useRef(false);

  const flushRef = useRef<() => void>(() => {});
  const editCommitPending = useRef(false);
  const send = useCallback(() => {
    const submittedAt = performance.now();
    const intent = composerSubmitIntent(latestOptions.current);
    if (intent === 'blocked') return;
    if (intent === 'queue') { flushRef.current(); return; }
    const draft = harvestDraft({
      voiceActive,
      cancelVoiceInput,
      ...readers,
    });
    if (!draft) return;

    if (intent === 'saveFollowUp') {
      if (editCommitPending.current || !editingFollowUpId) return;
      editCommitPending.current = true;
      void Promise.resolve().then(() => onCommitEditFollowUp(editingFollowUpId, draft.text,
        draft.attachments, getThinkingLevel(), draft.contextRefs)).then(accepted => {
        if (accepted === false) return;
        onUserTextCommitted?.(draft.text);
        const latest = latestOptions.current;
        if (latest.draftScope !== options.draftScope || latest.editingFollowUpId !== editingFollowUpId || latest.getTextValue() !== draft.text
          || JSON.stringify(latest.wireAttachmentsPayload()) !== JSON.stringify(draft.attachments)
          || JSON.stringify(latest.getContextRefs()) !== JSON.stringify(draft.contextRefs)) return;
        latest.onFinishFollowUpEdit?.();
        clearEditFollowUpRef();
      }).catch(error => showComposerNotification('error', error instanceof Error ? error.message : String(error)))
        .finally(() => { editCommitPending.current = false; });
      return;
    }
    const sendArgs: Parameters<ComposerSendHandler> = [
      draft.text,
      draft.attachments.length > 0 ? draft.attachments : undefined,
      getThinkingLevel(),
      draft.contextRefs.length > 0 ? draft.contextRefs : undefined,
      { submittedAt, onDispatched: (receipt) => onDispatched?.(receipt, draft) },
    ];
    const result = onSend(...sendArgs);
    commitAcceptedSend(result, (conversationId) => {
      onUserTextCommitted?.(draft.text, conversationId);
      const latest = latestOptions.current;
      const sourceScope = options.draftScope;
      const currentScope = latest.draftScope;
      // Preparing a project's first conversation binds the same editor to the accepted target.
      const boundToAcceptedTarget = intent === 'send' && sourceScope?.conversationId === null
        && conversationId !== undefined && currentScope?.conversationId === conversationId
        && currentScope.gatewayIdentity === sourceScope.gatewayIdentity;
      if ((!boundToAcceptedTarget && currentScope !== sourceScope) || latest.getTextValue() !== draft.text
        || JSON.stringify(latest.wireAttachmentsPayload()) !== JSON.stringify(draft.attachments)
        || JSON.stringify(latest.getContextRefs()) !== JSON.stringify(draft.contextRefs)) return;
      if (intent === 'replaceTurn') {
        if (latest.editingUserTurnId === options.editingUserTurnId) latest.onFinishUserEdit?.();
        return;
      }
      resetEditor();
      clearAttachments();
      clearContextRefs();
    });
  }, [
    runBusy, editingFollowUpId, onCommitEditFollowUp, clearEditFollowUpRef,
    voiceActive,
    cancelVoiceInput,
    onSend,
    onDispatched, options.editingUserTurnId, options.draftScope,
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

  const flushSteeringDraft = useCallback(async (
    interrupt = options.personal ? false : undefined,
    delivery: 'next' | 'steer' | undefined = options.personal ? 'steer' : undefined,
  ) => {
    if (latestOptions.current.editingFollowUpId || latestOptions.current.editingUserTurnId) { send(); return; }
    if (!runBusy && pendingFollowUpsCount === 0) return;
    const draft = harvestDraft({
      voiceActive,
      cancelVoiceInput,
      ...readers,
    });
    if (!draft) return;

    if (latestOptions.current.blocked) return;

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
      if (interrupt !== undefined || delivery !== undefined) args.push(interrupt);
      if (delivery !== undefined) args.push(delivery);
      await onAddPendingFollowUp(...args);
      onUserTextCommitted?.(draft.text);
      const latest = latestOptions.current;
      if (latest.draftScope !== options.draftScope || latest.editingFollowUpId || latest.editingUserTurnId
        || latest.getTextValue() !== draft.text
        || JSON.stringify(latest.wireAttachmentsPayload()) !== JSON.stringify(draft.attachments)
        || JSON.stringify(latest.getContextRefs()) !== JSON.stringify(draft.contextRefs)) return;
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
    send, runBusy,
    voiceActive,
    cancelVoiceInput,
    editingFollowUpId,
    pendingFollowUpsCount,
    onAddPendingFollowUp,
    onCommitEditFollowUp,
    getThinkingLevel,
    options.personal, options.draftScope,
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

  flushRef.current = () => { void flushSteeringDraft(); };

  const interruptDraft = useCallback(() => {
    if (latestOptions.current.blocked || latestOptions.current.editingFollowUpId || latestOptions.current.editingUserTurnId) return;
    if (!runBusy || !onSteeringInterrupt || interruptSubmissionRef.current) return;
    const draft = harvestDraft({
      voiceActive,
      cancelVoiceInput,
      ...readers,
    });
    if (!draft) return;

    interruptSubmissionRef.current = true;
    void (async () => {
      const accepted = await onSteeringInterrupt(
        draft.text,
        draft.attachments.length > 0 ? draft.attachments : undefined,
        draft.contextRefs.length > 0 ? draft.contextRefs : undefined,
      );
      if (accepted === false) return;
      onUserTextCommitted?.(draft.text);
      const latest = latestOptions.current;
      if (latest.draftScope !== options.draftScope || latest.editingFollowUpId || latest.editingUserTurnId
        || latest.getTextValue() !== draft.text
        || JSON.stringify(latest.wireAttachmentsPayload()) !== JSON.stringify(draft.attachments)
        || JSON.stringify(latest.getContextRefs()) !== JSON.stringify(draft.contextRefs)) return;
      resetEditor();
      clearAttachments();
      clearContextRefs();
    })().catch(error => showComposerNotification('error', error instanceof Error ? error.message : String(error)))
      .finally(() => { interruptSubmissionRef.current = false; });
  }, [
    runBusy,
    voiceActive,
    cancelVoiceInput,
    editingFollowUpId,
    onPendingFollowUpRemove,
    onSteeringInterrupt,
    options.draftScope,
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

  const steerCurrentReply = useCallback(() => {
    const latest = latestOptions.current;
    if (!latest.runBusy || latest.blocked || latest.voiceActive || latest.steeringPending
      || latest.editingFollowUpId || latest.editingUserTurnId) return;
    if (!latest.personal && latest.pendingFollowUpsCount > 0) {
      if (latest.firstPendingFollowUpId) latest.onSteerPendingFollowUp?.(latest.firstPendingFollowUpId);
      return;
    }
    void flushSteeringDraft(false, 'steer');
  }, [flushSteeringDraft]);

  return { send, flushSteeringDraft, interruptDraft, steerCurrentReply };
}
