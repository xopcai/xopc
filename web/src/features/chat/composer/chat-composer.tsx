import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { MAX_CHAT_ATTACHMENTS } from '@/features/chat/attachments/attachment-utils';
import { ACCEPT } from '@/features/chat/composer/composer-clipboard';
import { ChatComposerInput, type ComposerKbdContext } from '@/features/chat/composer/chat-composer-input';
import { ChatPendingFollowUpStack } from '@/features/chat/follow-up/chat-pending-follow-up-stack';
import { ComposerAttachmentChips } from '@/features/chat/composer/composer-attachment-chips';
import { ComposerToolbar } from '@/features/chat/composer/composer-toolbar';
import { wireFollowUpAttachmentsToComposer } from '@/features/chat/composer/follow-up-attachments-wire';
import type { SessionManager } from '@/features/chat/session/session-manager';
import type { AtMentionItem } from '@/features/chat/palette/at-mention-api';
import { recordRecentAtPath } from '@/features/chat/palette/at-mention-recent';
import { AtMentionPicker } from '@/features/chat/palette/at-mention-picker';
import { CommandPalette } from '@/features/chat/palette/command-palette';
import { fetchCommandsCached } from '@/features/chat/palette/command-palette-api';
import type { PendingFollowUp } from '@/features/chat/follow-up/pending-follow-up.types';
import type { PaletteItem } from '@/features/chat/palette/command-palette.types';
import { interpolate, type WireAttachment } from '@/features/chat/composer/composer.types';
import { useComposerInputHistoryWalk } from '@/features/chat/composer/use-composer-input-history-walk';
import type { Message } from '@/features/chat/messages/messages.types';
import { formatFilePathForWire } from '@/features/chat/palette/file-wire-pattern';
import {
  browseDirFromQuery,
  browseParentDir,
  detectAtRange,
  useAtMentionPicker,
} from '@/features/chat/palette/use-at-mention-picker';
import { useCommandPalette } from '@/features/chat/palette/use-command-palette';
import { useComposerActions } from '@/features/chat/composer/use-composer-actions';
import { useComposerAttachments } from '@/features/chat/composer/use-composer-attachments';
import { useComposerEditor } from '@/features/chat/composer/use-composer-editor';
import { useComposerVoice } from '@/features/chat/composer/use-composer-voice';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

export type { ThinkingLevel } from '@/features/chat/composer/composer.types';
export { collectClipboardFiles, isComposerAcceptableFile } from '@/features/chat/composer/composer-clipboard';

export const ChatComposer = memo(function ChatComposer({
  disabled,
  sending,
  streaming,
  sessionKey,
  sessionManager,
  canSelectWorkingDirectory,
  thinkingLevel,
  showThinkingSelector,
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
  sessionModel,
  showModelSelector,
  onModelChange,
  modelDisabled,
  contextUsageMessages,
}: {
  disabled: boolean;
  sending: boolean;
  streaming: boolean;
  sessionKey: string | null;
  sessionManager: SessionManager;
  welcomeDraftSeed?: { id: number; text: string } | null;
  canSelectWorkingDirectory: boolean;
  sessionModel: string;
  showModelSelector: boolean;
  onModelChange: (modelId: string) => void;
  modelDisabled: boolean;
  /** Messages in the active session (for context-window ring). */
  contextUsageMessages: readonly Message[];
  thinkingLevel: string;
  showThinkingSelector: boolean;
  onThinkingChange: (level: string) => void;
  onSend: (text: string, attachments?: WireAttachment[], thinkingLevel?: string) => void;
  onAbort: () => void;
  onAddPendingFollowUp?: (text: string, attachments?: WireAttachment[]) => void | Promise<void>;
  onSteeringInterrupt?: (text: string, attachments?: WireAttachment[]) => void;
  pendingFollowUps: PendingFollowUp[];
  editingFollowUpId: string | null;
  onBeginEditFollowUp: (id: string) => void;
  onCancelEditFollowUp: () => void;
  onCommitEditFollowUp: (
    id: string,
    text: string,
    attachments?: PendingFollowUp['attachments'],
    thinkingLevel?: string,
  ) => void;
  onPendingFollowUpRemove: (id: string) => void;
  onPendingFollowUpMove: (id: string, dir: 'up' | 'down') => void;
  onPendingFollowUpReorder: (fromIndex: number, toIndex: number) => void;
  onPendingFollowUpSteer: (id: string) => void;
  steeringFollowUpId: string | null;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  useEffect(() => {
    void fetchCommandsCached();
  }, []);
  const shouldSyncSelectionRef = useRef(false);
  const commandPalettePanelRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastLoadedEditFollowUpIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const onSendRef = useRef(onSend);
  const thinkingLevelRef = useRef(thinkingLevel);
  onSendRef.current = onSend;
  thinkingLevelRef.current = thinkingLevel;

  const att = useComposerAttachments({ chat: m.chat });
  const onExternalTextReplace = useCallback(() => {
    att.clearAttachments();
  }, [att.clearAttachments]);

  const editor = useComposerEditor({
    disabled,
    welcomeDraftSeed,
    onExternalTextReplace,
    shouldSyncSelectionRef,
  });

  const { onUserTextCommitted, onWireInputClearWalk, tryInputHistoryArrow } =
    useComposerInputHistoryWalk({
      sessionKey,
      editorRef: editor.editorRef,
      valueRef: editor.valueRef,
      resetEditor: editor.resetEditor,
      onWireInput: editor.onWireInput,
    });

  const atRangeRaw = useMemo(
    () => detectAtRange(editor.value, editor.cursor),
    [editor.value, editor.cursor],
  );
  const palette = useCommandPalette(editor.value, editor.cursor, {
    suppress: atRangeRaw != null,
    isComposing: editor.isComposing,
  });
  const atPicker = useAtMentionPicker(editor.value, editor.cursor, {
    sessionKey,
    slashPaletteOpen: palette.open,
    isComposing: editor.isComposing,
    precomputedAtRange: atRangeRaw,
  });

  shouldSyncSelectionRef.current = palette.open || atPicker.open || atRangeRaw != null;

  const composerDraftChars = useMemo(() => editor.value.length, [editor.value]);

  const runBusy = sending || streaming;
  busyRef.current = runBusy;

  const voice = useComposerVoice({
    disabled,
    runBusy,
    chat: m.chat,
    getAttachmentCount: () => att.attachmentsRef.current.length,
    onAutoSend: (text, w, level) => {
      onSendRef.current(text, w, level);
      onUserTextCommitted(text);
    },
    wireAttachmentsPayload: att.wireAttachmentsPayload,
    getTextValue: () => editor.valueRef.current,
    getThinkingLevel: () => thinkingLevelRef.current,
    resetEditor: () => {
      editor.resetEditor();
    },
    clearAttachments: att.clearAttachments,
    isRunBusy: () => busyRef.current,
  });

  const clearEditFollowUpRef = useCallback(() => {
    lastLoadedEditFollowUpIdRef.current = null;
  }, []);

  const actions = useComposerActions({
    chat: m.chat,
    runBusy,
    voiceRecording: voice.voiceRecording,
    stopVoiceRecording: voice.stopVoiceRecording,
    editingFollowUpId,
    getTextValue: () => editor.valueRef.current,
    getAttachmentCount: () => att.attachmentsRef.current.length,
    wireAttachmentsPayload: att.wireAttachmentsPayload,
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
    clearEditFollowUpRef,
    onUserTextCommitted,
  });

  const replaceRange = (text: string, start: number, end: number, insert: string) =>
    text.slice(0, start) + insert + text.slice(end);

  const paletteSlashRangeRef = useRef(palette.slashRange);
  paletteSlashRangeRef.current = palette.slashRange;

  useEffect(() => {
    if (!palette.open) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) {
        return;
      }
      if (editor.editorRef.current?.contains(t)) {
        return;
      }
      if (commandPalettePanelRef.current?.contains(t)) {
        return;
      }
      if (t instanceof Element && t.closest('[data-slash-palette-tooltip]')) {
        return;
      }
      const range = paletteSlashRangeRef.current;
      if (!range) {
        return;
      }
      const v = editor.valueRef.current;
      const next = v.slice(0, range.start) + v.slice(range.end);
      editor.resetEditor({ nextText: next, caretOffset: range.start });
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editor.resetEditor, palette.open]);

  const applyPaletteItem = (item: PaletteItem) => {
    const range = palette.slashRange;
    if (!range) return;
    if (item.kind === 'command' && range.start === 0 && busyRef.current) {
      return;
    }

    if (item.kind === 'skill') {
      const insert = `/skill:${item.name} `;
      const next = replaceRange(editor.valueRef.current, range.start, range.end, insert);
      const pos = range.start + insert.length;
      editor.resetEditor({ nextText: next, caretOffset: pos, focus: true });
      return;
    }

    if (item.kind === 'command' && range.start !== 0) {
      return;
    }

    const accepts = item.acceptsArgs === true;
    if (!accepts) {
      const cmd = `/${item.name}`;
      onSend(cmd, undefined, thinkingLevel);
      onUserTextCommitted(cmd);
      att.clearAttachments();
      editor.resetEditor();
      return;
    }

    const insert = `/${item.name} `;
    const next = replaceRange(editor.valueRef.current, range.start, range.end, insert);
    const pos = range.start + insert.length;
    editor.resetEditor({ nextText: next, caretOffset: pos, focus: true });
  };

  const applyAtMentionItem = (item: AtMentionItem, opts?: { stayOpen?: boolean }) => {
    const range = atPicker.atRange;
    if (!range) return;
    if (item.isBrowseUp) {
      const dir = browseDirFromQuery(range.query);
      const parentDir = browseParentDir(dir);
      const newQuery = parentDir ? `${parentDir}/` : '';
      const insert = `@${newQuery}`;
      const next = replaceRange(editor.valueRef.current, range.start, range.end, insert);
      const pos = range.start + insert.length;
      editor.resetEditor({ nextText: next, caretOffset: pos, focus: true });
      return;
    }

    const path =
      item.isDirectory && !item.relativePath.endsWith('/') ? `${item.relativePath}/` : item.relativePath;

    const wire = `@file:${formatFilePathForWire(path)}`;

    if (sessionKey && !item.isDirectory) {
      recordRecentAtPath(sessionKey, path.replace(/\/$/, ''));
    }

    const suffix = opts?.stayOpen ? ' @' : ' ';
    const insert = wire + suffix;
    const next = replaceRange(editor.valueRef.current, range.start, range.end, insert);
    const pos = range.start + insert.length;
    editor.resetEditor({ nextText: next, caretOffset: pos, focus: true });
  };

  useLayoutEffect(() => {
    if (!editingFollowUpId) {
      if (lastLoadedEditFollowUpIdRef.current) {
        att.clearAttachments();
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
    if (row.thinkingLevel != null && showThinkingSelector) {
      onThinkingChange(row.thinkingLevel);
    }
    att.setAttachments(wireFollowUpAttachmentsToComposer(row.attachments ?? []));
    editor.resetEditor({ nextText: row.text, focus: true });
  }, [
    att.clearAttachments,
    att.setAttachments,
    editor.resetEditor,
    editingFollowUpId,
    onCancelEditFollowUp,
    onThinkingChange,
    pendingFollowUps,
    showThinkingSelector,
  ]);

  const openFollowUpInComposer = useCallback(
    (id: string) => {
      onBeginEditFollowUp(id);
    },
    [onBeginEditFollowUp],
  );

  const kbdRef = useRef({} as ComposerKbdContext);

  kbdRef.current = {
    palette,
    atPicker,
    replaceRange,
    applyPaletteItem,
    applyAtMentionItem,
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
    setValue: editor.setValue,
    setCursor: editor.setCursor,
    adjustHeight: editor.adjustHeight,
    editorRef: editor.editorRef,
    resetEditor: editor.resetEditor,
    tryInputHistoryArrow,
  };

  const runBusyState = runBusy;
  const hasDraft =
    Boolean(editor.value.trim()) || att.attachments.length > 0;
  const showSteeringInterrupt = hasDraft && Boolean(onSteeringInterrupt);

  return (
    <div
      className={cn(
        'relative flex min-h-0 w-full flex-col overflow-hidden rounded-xl bg-surface-panel shadow-surface ring-1 ring-inset ring-edge dark:bg-surface-panel/60 dark:shadow-none',
        att.isDragging && 'ring-2 ring-accent ring-inset',
      )}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
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
        if (files?.length) await att.processFiles(Array.from(files));
      }}
    >
      {att.isDragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-accent-soft/80 text-sm font-medium text-accent-fg backdrop-blur-[1px]">
          {m.chat.dropFiles}
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
            open={atPicker.open}
            anchorRef={editor.editorRef}
            items={atPicker.items}
            selectedIndex={atPicker.selectedIndex}
            loading={atPicker.loading}
            query={atPicker.query}
            noResults={atPicker.error ?? m.chat.atMention.noResults}
            sessionKey={sessionKey}
            recentLabel={m.chat.atMention.recentBadge}
            ariaLabel={m.chat.atMention.placeholder}
            shiftHint={m.chat.atMention.shiftHint}
            onSelectItem={(it, meta) => applyAtMentionItem(it, { stayOpen: meta?.shiftKey === true })}
          />
          <CommandPalette
            open={palette.open}
            anchorRef={editor.editorRef}
            panelRef={commandPalettePanelRef}
            items={palette.loadError ? [] : palette.items}
            selectedIndex={palette.selectedIndex}
            noResults={palette.loadError ?? m.chat.commandPalette.noResults}
            grouped={palette.loadError ? false : palette.grouped}
            skillRowCount={palette.loadError ? 0 : palette.skillRowCount}
            query={palette.query}
            skillsLabel={m.chat.commandPalette.skillsSection}
            commandsLabel={m.chat.commandPalette.commandsSection}
            groupedHasSkills={palette.loadError ? false : palette.groupedHasSkills}
            groupedHasCommands={palette.loadError ? false : palette.groupedHasCommands}
            groupedSkillsShowMoreLabel={
              palette.loadError || !palette.grouped
                ? null
                : palette.groupedSkillsMoreCount > 0
                  ? interpolate(m.chat.commandPalette.showGroupedMore, { count: palette.groupedSkillsMoreCount })
                  : null
            }
            groupedCommandsShowMoreLabel={
              palette.loadError || !palette.grouped
                ? null
                : palette.groupedCommandsMoreCount > 0
                  ? interpolate(m.chat.commandPalette.showGroupedMore, { count: palette.groupedCommandsMoreCount })
                  : null
            }
            onExpandSkills={palette.expandGroupedSkills}
            onExpandCommands={palette.expandGroupedCommands}
            onSelectItem={applyPaletteItem}
          />
          <ChatComposerInput
            editorRef={editor.editorRef}
            disabled={disabled}
            placeholder={
              runBusyState
                ? editingFollowUpId
                  ? m.chat.inputPlaceholderSteeringEdit
                  : m.chat.inputPlaceholderSteering
                : m.chat.inputPlaceholder
            }
            onWireInput={onWireInputClearWalk}
            adjustHeight={editor.adjustHeight}
            processFiles={att.processFiles}
            setIsComposing={editor.setIsComposing}
            kbdRef={kbdRef}
            chatMessages={m.chat}
          />
        </div>

        <ComposerToolbar
          sessionKey={sessionKey}
          sessionManager={sessionManager}
          disabled={disabled}
          sending={sending}
          streaming={streaming}
          canSelectWorkingDirectory={canSelectWorkingDirectory}
          runBusy={runBusyState}
          chat={m.chat}
          hasDraft={hasDraft}
          showSteeringInterrupt={showSteeringInterrupt}
          attachmentCount={att.attachments.length}
          maxAttachments={MAX_CHAT_ATTACHMENTS}
          onPickFiles={() => fileInputRef.current?.click()}
          thinkingLevel={thinkingLevel}
          showThinkingSelector={showThinkingSelector}
          onThinkingChange={onThinkingChange}
          voiceRecording={voice.voiceRecording}
          onToggleVoice={voice.toggleVoiceRecording}
          onSend={actions.send}
          onAbort={onAbort}
          onInterrupt={actions.interruptDraft}
          sessionModel={sessionModel}
          showModelSelector={showModelSelector}
          onModelChange={onModelChange}
          modelDisabled={modelDisabled}
          contextUsageMessages={contextUsageMessages}
          composerDraftChars={composerDraftChars}
        />
      </div>
    </div>
  );
});
