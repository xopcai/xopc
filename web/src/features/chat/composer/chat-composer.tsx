import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useSearchParams } from 'react-router-dom';

import { MAX_CHAT_ATTACHMENTS } from '@/features/chat/attachments/attachment-utils';
import type { Attachment } from '@/features/chat/attachments/attachment-utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ACCEPT } from '@/features/chat/composer/composer-clipboard';
import { ChatComposerInput, type ComposerKbdContext } from '@/features/chat/composer/chat-composer-input';
import { shouldRouteGlobalComposerPaste } from '@/features/chat/composer/composer-global-paste';
import { applyComposerPaste, resolveComposerPaste } from '@/features/chat/composer/composer-paste';
import { ChatPendingFollowUpStack } from '@/features/chat/follow-up/chat-pending-follow-up-stack';
import { ComposerAttachmentChips } from '@/features/chat/composer/composer-attachment-chips';
import { ComposerContextChips } from '@/features/chat/composer/composer-context-chips';
import { ComposerContextBar, type ComposerContextBarProps } from '@/features/chat/composer/composer-context-bar';
import { takeComposerAttachmentHandoff } from '@/features/chat/composer/composer-attachment-handoff';
import { ComposerToolbar } from '@/features/chat/composer/composer-toolbar';
import { wireFollowUpAttachmentsToComposer } from '@/features/chat/composer/follow-up-attachments-wire';
import { MAX_PENDING_FOLLOW_UPS } from '@/features/chat/follow-up/pending-follow-up.types';
import { AtMentionPicker } from '@/features/chat/palette/at-mention-picker';
import { CommandPalette } from '@/features/chat/palette/command-palette';
import {
  addSkillToAgentAllowlist,
  fetchCommandsCached,
  getWorkspaceTrust,
  setWorkspaceTrust,
  type WorkspaceTrustState,
} from '@/features/chat/palette/command-palette-api';
import type { PendingFollowUp } from '@/features/chat/follow-up/pending-follow-up.types';
import {
  interpolate,
  MAX_COMPOSER_CONTEXT_REFS,
  type ComposerContextRef,
  type ComposerSendHandler,
  type WireAttachment,
} from '@/features/chat/composer/composer.types';
import type { FillChatComposerDetail } from '@/features/chat/composer/fill-composer-dispatch';
import { useComposerInputHistoryWalk } from '@/features/chat/composer/use-composer-input-history-walk';
import type { WelcomeSuggestionSelection } from '@/features/chat/welcome/welcome-suggestions';
import { useComposerActions } from '@/features/chat/composer/use-composer-actions';
import { commitAcceptedSend } from '@/features/chat/composer/commit-accepted-send';
import { useComposerAttachments } from '@/features/chat/composer/use-composer-attachments';
import { useComposerEditor } from '@/features/chat/composer/use-composer-editor';
import { useComposerPickers } from '@/features/chat/composer/use-composer-pickers';
import { appendTranscriptToDraft } from '@/features/chat/composer/append-transcript-to-draft';
import { ComposerVoiceInputBar } from '@/features/chat/composer/composer-voice-input-bar';
import { useRealtimeVoice } from '@/features/voice/realtime/use-realtime-voice';
import { useVoiceCall } from '@/features/voice/realtime/voice-call-context';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { ReviewLauncherDialog } from '@/features/chat/review/review-launcher-dialog';
import { inferMimeTypeFromFileName } from '@/features/chat/attachments/attachment-utils-core';
import { fetchWorkspaceFileBlob } from '@/features/workspace/workspace-api';
import { hasWorkspaceFileDrag, readWorkspaceFileDrag } from '@/features/workspace/workspace-file-drag';
import {
  takePendingVoiceInputToggle,
  queuePendingVoiceInputToggle,
  type VoiceInputShortcutTarget,
  VOICE_INPUT_CANCEL_EVENT,
  VOICE_INPUT_TOGGLE_EVENT,
} from '@/features/voice/voice-input-shortcut-events';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

function composerAttachmentFromWire(attachment: WireAttachment): Attachment {
  const mimeType = attachment.mimeType || 'application/octet-stream';
  const type: Attachment['type'] = attachment.type === 'voice' || mimeType.startsWith('audio/')
    ? 'voice'
    : attachment.type === 'pasted_text'
      ? 'pasted_text'
      : mimeType.startsWith('image/')
        ? 'image'
        : 'document';
  return {
    id: attachment.id,
    type,
    name: attachment.name || 'file',
    mimeType,
    size: attachment.size ?? 0,
    content: attachment.data ?? '',
    data: attachment.data,
    uri: attachment.uri,
    durationSeconds: attachment.durationSeconds,
  };
}

export const ChatComposer = memo(function ChatComposer({
  disabled,
  sending,
  streaming,
  sessionKey,
  composerContext,
  contextRefs,
  setContextRefs,
  thinkingLevel,
  modelSupportsThinking,
  onThinkingChange,
  onSend,
  onAbort,
  onAddPendingFollowUp,
  onSteeringInterrupt,
  pendingFollowUps,
  editingFollowUpId,
  onBeginEditFollowUp,
  onCancelEditFollowUp,
  onCommitEditFollowUp,
  onPendingFollowUpRemove,
  onPendingFollowUpMove,
  onPendingFollowUpReorder,
  onPendingFollowUpSteer,
  steeringFollowUpId,
  welcomeDraftSeed,
  welcomeSuggestion,
  onAcceptWelcomeSuggestion,
  sessionModel,
  showModelSelector,
  onModelChange,
  modelDisabled,
  onChatAgentChange,
  currentAgentId,
  voiceAgentName,
  voiceTaskId,
  prepareVoiceSession,
  editingUserTurnId,
  onCancelUserMessageEdit,
}: {
  disabled: boolean;
  sending: boolean;
  streaming: boolean;
  sessionKey: string | null;
  composerContext?: Omit<ComposerContextBarProps, 'sessionKey' | 'disabled'> & { disabled?: boolean };
  contextRefs: ComposerContextRef[];
  setContextRefs: Dispatch<SetStateAction<ComposerContextRef[]>>;
  welcomeDraftSeed?: { id: number; text: string } | null;
  welcomeSuggestion?: WelcomeSuggestionSelection | null;
  onAcceptWelcomeSuggestion?: (selection: WelcomeSuggestionSelection) => void;
  sessionModel: string;
  showModelSelector: boolean;
  onModelChange: (modelId: string) => void | Promise<void>;
  modelDisabled: boolean;
  thinkingLevel: string;
  modelSupportsThinking: boolean;
  onThinkingChange: (level: string) => void | Promise<void>;
  onSend: ComposerSendHandler;
  onAbort: () => void;
  onAddPendingFollowUp?: (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[]) => void | Promise<void>;
  onSteeringInterrupt?: (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[]) => void;
  pendingFollowUps: PendingFollowUp[];
  editingFollowUpId: string | null;
  onBeginEditFollowUp: (id: string) => void;
  onCancelEditFollowUp: () => void;
  onCommitEditFollowUp: (
    id: string,
    text: string,
    attachments?: PendingFollowUp['attachments'],
    thinkingLevel?: string,
    contextRefs?: ComposerContextRef[],
  ) => void;
  onPendingFollowUpRemove: (id: string) => void;
  onPendingFollowUpMove: (id: string, dir: 'up' | 'down') => void;
  onPendingFollowUpReorder: (fromIndex: number, toIndex: number) => void;
  onPendingFollowUpSteer: (id: string) => void;
  steeringFollowUpId: string | null;
  /** Optional: when provided, `/` palette lists agents and selecting one switches the active agent. */
  onChatAgentChange?: (agentId: string) => void;
  /** Active session agent id; the matching agent row in `/` palette gets a "current" badge. */
  currentAgentId?: string;
  voiceAgentName?: string;
  voiceTaskId?: string;
  prepareVoiceSession?: () => Promise<string>;
  editingUserTurnId?: string | null;
  onCancelUserMessageEdit?: () => void;
}) {
  const call = useVoiceCall();
  const preparingCallRef = useRef(false);
  disabled = disabled || call.sessionKey === sessionKey && call.active;
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    void fetchCommandsCached();
  }, []);
  const shouldSyncSelectionRef = useRef(false);
  const commandPalettePanelRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastLoadedEditFollowUpIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [workspaceTrustPrompt, setWorkspaceTrustPrompt] = useState<WorkspaceTrustState | null>(null);
  const [workspaceTrustDismissedFor, setWorkspaceTrustDismissedFor] = useState<string | null>(null);
  const [workspaceTrustSaving, setWorkspaceTrustSaving] = useState(false);
  const onSendRef = useRef(onSend);
  const thinkingLevelRef = useRef(thinkingLevel);
  onSendRef.current = onSend;
  thinkingLevelRef.current = thinkingLevel;

  useEffect(() => {
    if (!sessionKey || workspaceTrustDismissedFor === sessionKey) {
      setWorkspaceTrustPrompt(null);
      return;
    }
    let cancelled = false;
    void getWorkspaceTrust(sessionKey)
      .then((state) => {
        if (cancelled) return;
        setWorkspaceTrustPrompt(state.required && !state.trusted && state.decision === null ? state : null);
      })
      .catch(() => {
        if (!cancelled) setWorkspaceTrustPrompt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionKey, workspaceTrustDismissedFor]);

  const trustWorkspace = useCallback(() => {
    if (!sessionKey || workspaceTrustSaving) return;
    setWorkspaceTrustSaving(true);
    void setWorkspaceTrust(sessionKey, true)
      .then(() => {
        setWorkspaceTrustPrompt(null);
      })
      .catch((err) => {
        showComposerNotification(
          'error',
          m.chat.commandPalette.workspaceTrustFailed,
          { error: err instanceof Error ? err.message : String(err) },
        );
      })
      .finally(() => setWorkspaceTrustSaving(false));
  }, [m.chat.commandPalette, sessionKey, workspaceTrustSaving]);

  const att = useComposerAttachments({ chat: m.chat });
  const onExternalTextReplace = useCallback((detail?: FillChatComposerDetail) => {
    setContextRefs(detail?.contextRefs ?? []);
    if (detail?.attachments) {
      att.setAttachments(detail.attachments.map(composerAttachmentFromWire));
      return;
    }
    att.clearAttachments();
  }, [att.clearAttachments, att.setAttachments, setContextRefs]);

  const addContextRef = useCallback((ref: ComposerContextRef) => {
    setContextRefs((current) => {
      if (current.some((item) => item.sourceId === ref.sourceId)) return current;
      if (current.length >= MAX_COMPOSER_CONTEXT_REFS) {
        showComposerNotification('warning', m.chat.commandPalette.contextLimitReached, {
          max: MAX_COMPOSER_CONTEXT_REFS,
        });
        return current;
      }
      return [...current, ref];
    });
  }, [m.chat.commandPalette.contextLimitReached, setContextRefs]);

  const onUnavailableSkill = useCallback(
    (item: import('@/features/chat/palette/command-palette.types').PaletteItem) => {
      const reason = item.availability?.status === 'agent-denied'
        ? m.chat.commandPalette.skillAgentDeniedReason
        : m.chat.commandPalette.skillDisabledReason;
      const message = interpolate(m.chat.commandPalette.skillUnavailableMessage, {
        name: item.name,
        agent: currentAgentId || 'main',
        reason,
      });
      if (item.availability?.status === 'agent-denied' && window.confirm(`${message}\n\n${m.chat.commandPalette.skillAddToAllowlistConfirm}`)) {
        void addSkillToAgentAllowlist(currentAgentId, item.name, sessionKey).catch((err) => {
          window.alert(err instanceof Error ? err.message : String(err));
        });
        return;
      }
      window.alert(message);
    },
    [currentAgentId, m.chat.commandPalette, sessionKey],
  );

  const editor = useComposerEditor({
    disabled,
    autoFocusKey: sessionKey,
    welcomeDraftSeed,
    onExternalTextReplace,
    shouldSyncSelectionRef,
  });

  const attachmentHandoffId = searchParams.get('attachmentHandoff');
  useEffect(() => {
    if (!attachmentHandoffId) return;
    const file = takeComposerAttachmentHandoff(attachmentHandoffId);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('attachmentHandoff');
        return next;
      },
      { replace: true },
    );
    if (!file) return;
    void att.processFiles([file]).then(() => editor.editorRef.current?.focus());
  }, [attachmentHandoffId, att.processFiles, editor.editorRef, sessionKey, setSearchParams]);

  const { onUserTextCommitted, onWireInputClearWalk, tryInputHistoryArrow } =
    useComposerInputHistoryWalk({
      sessionKey,
      editorRef: editor.editorRef,
      valueRef: editor.valueRef,
      resetEditor: editor.resetEditor,
      onWireInput: editor.onWireInput,
    });

  const runBusy = sending || streaming;
  busyRef.current = runBusy;

  const openReviewLauncher = useCallback(() => {
    if (busyRef.current) return;
    setReviewOpen(true);
  }, []);

  const sendReviewCommand = useCallback(
    (command: string) => {
      commitAcceptedSend(onSendRef.current(command, undefined, thinkingLevelRef.current, contextRefs), () => {
        onUserTextCommitted?.(command);
        setContextRefs([]);
      });
    },
    [contextRefs, onUserTextCommitted, setContextRefs],
  );

  const pickers = useComposerPickers({
    sessionKey,
    editorValue: editor.value,
    editorCursor: editor.cursor,
    isComposing: editor.isComposing,
    runBusy,
    thinkingLevel,
    editorRef: editor.editorRef,
    valueRef: editor.valueRef,
    resetEditor: editor.resetEditor,
    clearAttachments: att.clearAttachments,
    onSend,
    onUserTextCommitted,
    onChatAgentChange,
    currentAgentId,
    contextRefs,
    onAddContextRef: addContextRef,
    onUnavailableSkill,
    onReviewLauncher: openReviewLauncher,
    onAddPendingFollowUp,
    onAbort,
    pendingFollowUpsCount: pendingFollowUps.length,
    maxPendingFollowUps: MAX_PENDING_FOLLOW_UPS,
    clearContextRefs: () => setContextRefs([]),
    commandPalettePanelRef,
  });

  shouldSyncSelectionRef.current = pickers.shouldSyncSelection;

  const voice = useRealtimeVoice({
    disabled: disabled || call.active,
    chat: m.chat,
    onTranscript: (text) => {
      const prev = editor.valueRef.current;
      const next = appendTranscriptToDraft(prev, text);
      editor.resetEditor({ nextText: next, caretOffset: next.length, focus: true });
    },
  });
  const {
    phase: voicePhase,
    voiceActive,
    startVoiceInput,
    cancelVoiceInput: cancelVoiceCapture,
    confirmVoiceInput,
  } = voice;

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const editorHidden = voiceActive && voicePhase !== 'error';
      if (!shouldRouteGlobalComposerPaste(event, { disabled, editorHidden })) return;

      const action = resolveComposerPaste(event.clipboardData);
      if (!action) return;

      event.preventDefault();
      editor.focusForExternalPaste();
      void applyComposerPaste(action, {
        processFiles: att.processFiles,
        processPastedText: att.processPastedText,
        insertText: (text) => document.execCommand('insertText', false, text),
        onUnsupportedFiles: () =>
          showComposerNotification('warning', m.chat.clipboardFileTypeUnsupported),
      });
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [
    att.processFiles,
    att.processPastedText,
    disabled,
    editor.focusForExternalPaste,
    m.chat.clipboardFileTypeUnsupported,
    voiceActive,
    voicePhase,
  ]);

  useEffect(() => {
    const toggleVoiceInput = (event?: Event) => {
      const target = (event as CustomEvent<{ target?: VoiceInputShortcutTarget }> | undefined)?.detail?.target;
      if (target && target !== 'chat') return;
      event?.preventDefault();
      if (disabled) return;
      if (voicePhase === 'recording') {
        confirmVoiceInput();
        return;
      }
      if (voicePhase === 'idle' || voicePhase === 'error') {
        editor.editorRef.current?.focus();
        void startVoiceInput();
      }
    };
    const cancelVoiceInput = (event: Event) => {
      const target = (event as CustomEvent<{ target?: VoiceInputShortcutTarget }>).detail?.target;
      if ((target && target !== 'chat') || !voiceActive) return;
      event.preventDefault();
      cancelVoiceCapture();
      editor.editorRef.current?.focus();
    };

    window.addEventListener(VOICE_INPUT_TOGGLE_EVENT, toggleVoiceInput);
    window.addEventListener(VOICE_INPUT_CANCEL_EVENT, cancelVoiceInput);
    const pendingTimer = window.setTimeout(() => {
      if (!takePendingVoiceInputToggle()) return;
      if (disabled) {
        queuePendingVoiceInputToggle();
        return;
      }
      toggleVoiceInput();
    }, 0);
    return () => {
      window.clearTimeout(pendingTimer);
      window.removeEventListener(VOICE_INPUT_TOGGLE_EVENT, toggleVoiceInput);
      window.removeEventListener(VOICE_INPUT_CANCEL_EVENT, cancelVoiceInput);
    };
  }, [
    cancelVoiceCapture,
    confirmVoiceInput,
    disabled,
    editor.editorRef,
    startVoiceInput,
    voiceActive,
    voicePhase,
  ]);

  const clearEditFollowUpRef = useCallback(() => {
    lastLoadedEditFollowUpIdRef.current = null;
  }, []);

  const actions = useComposerActions({
    chat: m.chat,
    runBusy,
    voiceActive: voice.voiceActive,
    cancelVoiceInput: voice.cancelVoiceInput,
    editingFollowUpId,
    getTextValue: () => editor.valueRef.current,
    getAttachmentCount: () => att.attachmentsRef.current.length,
    wireAttachmentsPayload: att.wireAttachmentsPayload,
    getContextRefs: () => contextRefs,
    getThinkingLevel: () => thinkingLevelRef.current,
    onSend,
    onAddPendingFollowUp,
    onSteeringInterrupt,
    onCommitEditFollowUp,
    onPendingFollowUpRemove,
    pendingFollowUpsCount: pendingFollowUps.length,
    resetEditor: () => {
      editor.resetEditor();
    },
    clearAttachments: att.clearAttachments,
    clearContextRefs: () => setContextRefs([]),
    clearEditFollowUpRef,
    onUserTextCommitted,
  });

  useLayoutEffect(() => {
    if (!editingFollowUpId) {
      if (lastLoadedEditFollowUpIdRef.current) {
        att.clearAttachments();
        setContextRefs([]);
        editor.resetEditor();
        lastLoadedEditFollowUpIdRef.current = null;
      }
      return;
    }
    if (editingFollowUpId === lastLoadedEditFollowUpIdRef.current) {
      return;
    }
    const row = pendingFollowUps.find((r) => r.id === editingFollowUpId);
    if (!row) {
      onCancelEditFollowUp();
      return;
    }
    lastLoadedEditFollowUpIdRef.current = editingFollowUpId;
    if (row.thinkingLevel != null && modelSupportsThinking) {
      onThinkingChange(row.thinkingLevel);
    }
    att.setAttachments(wireFollowUpAttachmentsToComposer(row.attachments ?? []));
    setContextRefs(row.contextRefs ?? []);
    editor.resetEditor({ nextText: row.text, focus: true });
  }, [
    att.clearAttachments,
    att.setAttachments,
    editor.resetEditor,
    editingFollowUpId,
    onCancelEditFollowUp,
    onThinkingChange,
    pendingFollowUps,
    modelSupportsThinking,
    setContextRefs,
  ]);

  const openFollowUpInComposer = useCallback(
    (id: string) => {
      onBeginEditFollowUp(id);
    },
    [onBeginEditFollowUp],
  );

  const kbdRef = useRef({} as ComposerKbdContext);

  kbdRef.current = {
    adapters: pickers.adapters,
    send: actions.send,
    runBusy,
    pendingFollowUpsCount: pendingFollowUps.length,
    flushSteeringDraft: actions.flushSteeringDraft,
    interruptDraft: actions.interruptDraft,
    editingFollowUpId,
    onCancelEditFollowUp,
    attachmentsLen: att.attachments.length,
    isComposing: editor.isComposing,
    valueRef: editor.valueRef,
    adjustHeight: editor.adjustHeight,
    editorRef: editor.editorRef,
    tryInputHistoryArrow,
    acceptEmptySuggestion:
      !runBusy && welcomeSuggestion && onAcceptWelcomeSuggestion
        ? () => {
            onAcceptWelcomeSuggestion(welcomeSuggestion);
            return true;
          }
        : undefined,
  };

  const runBusyState = runBusy;
  const hasDraft =
    Boolean(editor.value.trim()) || att.attachments.length > 0;
  const showSteeringInterrupt = hasDraft && Boolean(onSteeringInterrupt);
  const contextualPlaceholder =
    !runBusyState && !editingFollowUpId && welcomeSuggestion
      ? `${welcomeSuggestion.prompt} · ${m.chat.welcomeSpotlight.acceptSuggestionHint}`
      : null;

  return (
    <div className="relative flex min-h-0 w-full flex-col">
      {composerContext ? <ComposerContextBar {...composerContext} sessionKey={sessionKey} disabled={(composerContext.disabled ?? disabled) || sending || streaming} /> : null}
    <div
      className={cn(
        'relative flex min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-surface-panel shadow-surface ring-1 ring-inset ring-edge dark:bg-surface-panel/60 dark:shadow-none',
        att.isDragging && 'ring-2 ring-accent ring-inset',
      )}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files') || hasWorkspaceFileDrag(e.dataTransfer)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          att.setIsDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) att.setIsDragging(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        att.setIsDragging(false);
        const files = e.dataTransfer?.files;
        if (files?.length) {
          await att.processFiles(Array.from(files));
          return;
        }
        const workspaceFile = readWorkspaceFileDrag(e.dataTransfer);
        if (!workspaceFile) return;
        try {
          const blob = await fetchWorkspaceFileBlob(workspaceFile.path, {
            sessionKey: workspaceFile.sessionKey,
            agentId: workspaceFile.agentId,
            projectId: workspaceFile.projectId,
          });
          const inferredMime = inferMimeTypeFromFileName(workspaceFile.name);
          const mimeType = blob.type && blob.type !== 'application/octet-stream'
            ? blob.type
            : inferredMime;
          await att.processFiles([
            new File([blob], workspaceFile.name, { type: mimeType }),
          ]);
        } catch {
          showComposerNotification('error', m.chat.attachmentLoadFailed, { name: workspaceFile.name });
        }
      }}
    >
      {att.isDragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-accent-soft/80 text-sm font-medium text-accent-fg backdrop-blur-[1px]">
          {m.chat.dropFiles}
        </div>
      ) : null}

      {editingUserTurnId ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-edge-subtle bg-accent-soft/40 px-4 py-2 text-xs text-fg-muted">
          <span>{m.chat.userMessageEditing}</span>
          <button
            type="button"
            className="font-medium text-accent-fg hover:underline"
            onClick={onCancelUserMessageEdit}
          >
            {m.chat.userMessageEditCancel}
          </button>
        </div>
      ) : null}

      {pendingFollowUps.length > 0 ? (
        <div className="max-h-[min(30vh,11rem)] shrink-0 overflow-y-auto overflow-x-hidden border-b border-edge-subtle/80 [scrollbar-gutter:stable] dark:border-edge-subtle/70">
          <ChatPendingFollowUpStack
            items={pendingFollowUps}
            disabled={disabled}
            editingFollowUpId={editingFollowUpId}
            onEditInComposer={openFollowUpInComposer}
            onRemove={onPendingFollowUpRemove}
            onMove={onPendingFollowUpMove}
            onReorder={onPendingFollowUpReorder}
            onSteer={onPendingFollowUpSteer}
            steeringBusyId={steeringFollowUpId}
          />
        </div>
      ) : null}

      <ComposerAttachmentChips
        attachments={att.attachments}
        topPadded={pendingFollowUps.length > 0}
        onRemove={att.removeAttachment}
      />

      <ComposerContextChips
        refs={contextRefs}
        label={m.chat.commandPalette.noteContextLabel}
        onRemove={(sourceId) => setContextRefs((current) => current.filter((ref) => ref.sourceId !== sourceId))}
      />


      <div className="flex min-h-0 shrink-0 flex-col">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={async (e) => {
            const files = e.target.files;
            if (files) await att.processFiles(Array.from(files));
            e.target.value = '';
          }}
        />

        <div
          className={cn('relative px-4 pb-0 pt-1', att.attachments.length > 0 && 'pt-2')}
        >
          <AtMentionPicker
            open={pickers.atPicker.open}
            anchorRef={editor.editorRef}
            items={pickers.atPicker.items}
            selectedIndex={pickers.atPicker.selectedIndex}
            loading={pickers.atPicker.loading}
            query={pickers.atPicker.query}
            noResults={pickers.atPicker.error ?? m.chat.atMention.noResults}
            sessionKey={sessionKey}
            recentLabel={m.chat.atMention.recentBadge}
            filesLabel={m.chat.atMention.files}
            notesLabel={m.chat.atMention.notes}
            ariaLabel={m.chat.atMention.placeholder}
            shiftHint={m.chat.atMention.shiftHint}
            onSelectItem={(it, meta) => pickers.applyAtMention(it, { stayOpen: meta?.shiftKey === true })}
          />
          <CommandPalette
            open={pickers.palette.open}
            anchorRef={editor.editorRef}
            panelRef={commandPalettePanelRef}
            items={pickers.palette.loadError ? [] : pickers.palette.items}
            selectedIndex={pickers.palette.selectedIndex}
            noResults={pickers.palette.loadError ?? m.chat.commandPalette.noResults}
            grouped={pickers.palette.loadError ? false : pickers.palette.grouped}
            skillRowCount={pickers.palette.loadError ? 0 : pickers.palette.skillRowCount}
            commandRowCount={pickers.palette.loadError ? 0 : pickers.palette.commandRowCount}
            query={pickers.palette.query}
            skillsLabel={m.chat.commandPalette.skillsSection}
            commandsLabel={m.chat.commandPalette.commandsSection}
            agentsLabel={m.chat.commandPalette.agentsSection}
            groupedHasSkills={pickers.palette.loadError ? false : pickers.palette.groupedHasSkills}
            groupedHasCommands={pickers.palette.loadError ? false : pickers.palette.groupedHasCommands}
            groupedHasAgents={pickers.palette.loadError ? false : pickers.palette.groupedHasAgents}
            groupedSkillsShowMoreLabel={
              pickers.palette.loadError || !pickers.palette.grouped
                ? null
                : pickers.palette.groupedSkillsMoreCount > 0
                  ? interpolate(m.chat.commandPalette.showGroupedMore, { count: pickers.palette.groupedSkillsMoreCount })
                  : null
            }
            groupedCommandsShowMoreLabel={
              pickers.palette.loadError || !pickers.palette.grouped
                ? null
                : pickers.palette.groupedCommandsMoreCount > 0
                  ? interpolate(m.chat.commandPalette.showGroupedMore, { count: pickers.palette.groupedCommandsMoreCount })
                  : null
            }
            groupedAgentsShowMoreLabel={
              pickers.palette.loadError || !pickers.palette.grouped
                ? null
                : pickers.palette.groupedAgentsMoreCount > 0
                  ? interpolate(m.chat.commandPalette.showGroupedMore, { count: pickers.palette.groupedAgentsMoreCount })
                  : null
            }
            onExpandSkills={pickers.palette.expandGroupedSkills}
            onExpandCommands={pickers.palette.expandGroupedCommands}
            onExpandAgents={pickers.palette.expandGroupedAgents}
            currentAgentId={currentAgentId}
            currentBadgeLabel={m.chat.commandPalette.currentBadge}
            runBusy={runBusy}
            pendingFollowUpsCount={pendingFollowUps.length}
            maxPendingFollowUps={MAX_PENDING_FOLLOW_UPS}
            queueBadgeLabel={m.chat.commandPalette.queueBadge}
            queueFullBadgeLabel={m.chat.commandPalette.queueFullBadge}
            queueFullTooltip={m.chat.commandPalette.queueFullTooltip}
            skillUnavailableLabel={m.chat.commandPalette.skillUnavailableBadge}
            skillAgentDeniedLabel={m.chat.commandPalette.skillAgentDeniedBadge}
            onSelectItem={pickers.applyPalette}
          />
          {voice.voiceActive ? (
            <ComposerVoiceInputBar
              phase={voice.phase}
              elapsedLabel={voice.elapsedLabel}
              audioLevel={voice.audioLevel}
              partialTranscript={voice.partialTranscript}
              finalTranscript={voice.finalTranscript}
              disabled={disabled}
              chat={m.chat}
              onCancel={voice.cancelVoiceInput}
              onConfirm={voice.confirmVoiceInput}
              onRetry={voice.retryVoiceInput}
            />
          ) : null}
          <ChatComposerInput
            editorRef={editor.editorRef}
            disabled={disabled}
            hidden={voice.voiceActive && voice.phase !== 'error'}
            ariaLabel={m.chat.inputPlaceholder}
            placeholder={
              contextualPlaceholder ?? (runBusyState
                ? editingFollowUpId
                  ? m.chat.inputPlaceholderSteeringEdit
                  : m.chat.inputPlaceholderSteering
                : m.chat.inputPlaceholder)
            }
            onWireInput={onWireInputClearWalk}
            adjustHeight={editor.adjustHeight}
            processFiles={att.processFiles}
            processPastedText={att.processPastedText}
            setIsComposing={editor.setIsComposing}
            kbdRef={kbdRef}
            chatMessages={m.chat}
          />
        </div>

        <ComposerToolbar
          disabled={disabled}
          sending={sending}
          streaming={streaming}
          runBusy={runBusyState}
          chat={m.chat}
          hasDraft={hasDraft}
          showSteeringInterrupt={showSteeringInterrupt}
          attachmentCount={att.attachments.length}
          maxAttachments={MAX_CHAT_ATTACHMENTS}
          onPickFiles={() => fileInputRef.current?.click()}
          thinkingLevel={thinkingLevel}
          modelSupportsThinking={modelSupportsThinking}
          onThinkingChange={onThinkingChange}
          voiceActive={voice.voiceActive}
          onStartVoiceInput={voice.startVoiceInput}
          voiceConversationEnabled={Boolean(sessionKey || prepareVoiceSession) && !runBusyState}
          onStartVoiceConversation={() => {
            if (preparingCallRef.current) return;
            if (sessionKey) { call.open({ sessionKey, name: voiceAgentName || currentAgentId || 'xopc', taskId: voiceTaskId }); return; }
            if (!prepareVoiceSession) return;
            preparingCallRef.current = true;
            void prepareVoiceSession().then((key) => call.open({ sessionKey: key, name: voiceAgentName || currentAgentId || 'xopc', taskId: voiceTaskId }))
              .catch((error: unknown) => showComposerNotification('error', error instanceof Error ? error.message : m.chat.callFailed))
              .finally(() => { preparingCallRef.current = false; });
          }}
          onSend={actions.send}
          onAbort={onAbort}
          onInterrupt={actions.interruptDraft}
          sessionModel={sessionModel}
          showModelSelector={showModelSelector}
          onModelChange={onModelChange}
          modelDisabled={modelDisabled}
        />
      </div>
      <ReviewLauncherDialog
        open={reviewOpen}
        sessionKey={sessionKey}
        disabled={disabled || runBusyState}
        chat={m.chat}
        onClose={() => setReviewOpen(false)}
        onSendCommand={sendReviewCommand}
      />
      <ConfirmDialog
        open={workspaceTrustPrompt !== null}
        title={m.chat.commandPalette.workspaceTrustTitle}
        description={interpolate(m.chat.commandPalette.workspaceTrustDescription, {
          path: workspaceTrustPrompt?.workspacePath ?? '',
        })}
        confirmLabel={workspaceTrustSaving
          ? m.chat.commandPalette.workspaceTrustSaving
          : m.chat.commandPalette.workspaceTrustConfirm}
        cancelLabel={m.chat.commandPalette.workspaceTrustCancel}
        onConfirm={trustWorkspace}
        onCancel={() => {
          setWorkspaceTrustPrompt(null);
          setWorkspaceTrustDismissedFor(sessionKey);
        }}
      />
    </div>
    </div>
  );
});
