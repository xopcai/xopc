/**
 * Chat composer — content-sized input, attachments, and text / voice modes.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  type LayoutChangeEvent,
  DeviceEventEmitter,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { radii, spacing, typography, useTheme } from '../../theme';
import { detectAtMentionRange, formatWorkspacePath, replaceAtMention } from './at-mention-utils';
import { canSendComposerDraft, prepareComposerInput } from './composer-send-helpers';
import {
  MAX_COMPOSER_CONTEXT_REFS,
  type ComposerContextRef,
  type WireAttachment,
} from './composer.types';
import { ComposerReferenceSheet } from './ComposerReferenceSheet';
import type { ComposerReferenceItem, ReferenceKind } from '../../query/composer-references';
import { ComposerActionPanel } from './composer-action-panel';
import { AtMentionPaletteBar } from './AtMentionPaletteBar';
import { ComposerAttachmentStrip } from './composer-attachment-strip';
import { ComposerContextChips } from './ComposerContextChips';
import { CommandPaletteBar } from './CommandPaletteBar';
import { SlashTokenInput } from './SlashTokenInput';
import {
  clampComposerInputHeight,
  estimateComposerInputHeight,
  MAX_COMPOSER_INPUT_HEIGHT,
  MIN_COMPOSER_INPUT_HEIGHT,
} from './composer-layout';
import { useCommandPalette } from './useCommandPalette';
import { useAtMentionPicker, type MobileAtMentionItem } from './use-at-mention-picker';
import {
  clearComposerDraftSnapshot,
  readComposerDraftSnapshot,
  writeComposerDraftSnapshot,
} from './composer-draft-storage';
import { useComposerAttachments } from './use-composer-attachments';
import { useComposerHandoff } from './composer-handoff';
import { useGatewayStore } from '../../stores/gateway-store';
import { MOBILE_COMPOSER_APPEND_EVENT, MOBILE_COMPOSER_FILL_EVENT } from './mobile-composer-fill';
import { VoiceRecordingCard } from './VoiceRecordingCard';
import { useChatVoiceRecording } from './use-chat-voice-recording';
import { useVoiceCall } from '../voice/voice-call';
import {
  COMPOSER_VOICE_CALL_OPTIONS,
  type ComposerVoiceCallMode,
} from './composer-voice-call-options';

type InputMode = 'text' | 'voice';

export const ChatComposer = memo(function ChatComposer({
  conversationId,
  actionsOpen,
  onActionsOpenChange,
  disabled,
  streaming,
  onSend,
  onAbort,
  placeholder,
  suggestionDraft,
  mainConversation = false,
  onConsumeSuggestionDraft,
  contextRefs,
  onContextRefsChange,
  contextControl,
  onNewChat,
  onVoiceCallStart,
  voiceCallUnavailable,
}: {
  conversationId: string;
  actionsOpen: boolean;
  onActionsOpenChange: (open: boolean) => void;
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[], delivery?: 'next' | 'steer') => Promise<boolean>;
  onAbort: () => void;
  placeholder?: string;
  suggestionDraft?: string;
  mainConversation?: boolean;
  onConsumeSuggestionDraft?: () => void;
  contextRefs: ComposerContextRef[];
  onContextRefsChange: (refs: ComposerContextRef[]) => void;
  contextControl?: ReactNode;
  onNewChat: () => void;
  onVoiceCallStart: (mode?: ComposerVoiceCallMode) => void;
  voiceCallMode?: ComposerVoiceCallMode;
  voiceCallUnavailable?: Partial<Record<ComposerVoiceCallMode, boolean>>;
}) {
  const onCloseActions = useCallback(() => onActionsOpenChange(false), [onActionsOpenChange]);
  const m = useMessages();
  const cm = m.chat;
  const { colors, elevation } = useTheme();

  const [referenceKind, setReferenceKind] = useState<ReferenceKind | null>(null);
  useEffect(() => setReferenceKind(null), [conversationId, disabled]);
  const [mode, setMode] = useState<InputMode>('text');
  const [draft, setDraft] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_COMPOSER_INPUT_HEIGHT);
  const [inputWidth, setInputWidth] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const fillSubscription = DeviceEventEmitter.addListener(
      MOBILE_COMPOSER_FILL_EVENT,
      (event: { conversationId: string; text: string }) => {
        if (event.conversationId !== conversationId) return;
        const text = event.text;
        setMode('text');
        setDraft(text);
        setCursorPos(text.length);
        requestAnimationFrame(() => inputRef.current?.focus());
      },
    );
    const appendSubscription = DeviceEventEmitter.addListener(
      MOBILE_COMPOSER_APPEND_EVENT,
      (event: { conversationId: string; text: string }) => {
        if (event.conversationId !== conversationId) return;
        const text = event.text;
        setMode('text');
        setDraft((current) => {
          const separator = current && !/\s$/.test(current) ? ' ' : '';
          const next = `${current}${separator}${text}`;
          setCursorPos(next.length);
          return next;
        });
        requestAnimationFrame(() => inputRef.current?.focus());
      },
    );
    return () => {
      fillSubscription.remove();
      appendSubscription.remove();
    };
  }, [conversationId]);

  const att = useComposerAttachments({
    maxAttachmentsReached: cm.maxAttachmentsReached,
    maxAttachmentsTruncated: cm.maxAttachmentsTruncated,
    attachmentFileTooLarge: cm.attachmentFileTooLarge,
    attachmentLoadFailed: cm.attachmentLoadFailed,
    attachmentPermissionDenied: cm.attachmentPermissionDenied,
    attachmentCameraPermissionDenied: cm.attachmentCameraPermissionDenied,
  });

  useEffect(() => { onCloseActions(); }, [conversationId, disabled, onCloseActions]);
  useFocusEffect(useCallback(() => () => onCloseActions(), [onCloseActions]));

  const atRangeActive = detectAtMentionRange(draft, cursorPos) !== null;
  const palette = useCommandPalette(draft, cursorPos, atRangeActive);
  const atPicker = useAtMentionPicker(draft, cursorPos, conversationId, palette.open);

  const [snack, setSnack] = useState('');
  const restoredDraftConversationIdRef = useRef<string | null>(null);
  const skipDraftPersistConversationIdRef = useRef<string | null>(null);
  const runBusy = streaming || disabled;
  const hasDraft = canSendComposerDraft(draft, att.attachments.length, contextRefs.length);
  /** Programmatic draft updates (palette, suggestions, restore) set cursor explicitly. */
  const updateDraft = useCallback(
    (nextDraft: string, nextCursor = nextDraft.length) => {
      setDraft(nextDraft);
      setCursorPos(nextCursor);
      setInputHeight(estimateComposerInputHeight(nextDraft, inputWidth || undefined));
    },
    [inputWidth],
  );

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const contextRefsRef = useRef(contextRefs);
  contextRefsRef.current = contextRefs;
  const onRecordingDraft = useCallback((attachment: WireAttachment) => {
    att.setAttachments(previous => [...previous, {
      id: attachment.localUri!, type: 'audio', name: attachment.name!,
      mimeType: attachment.mimeType!, size: 0, content: '',
      localUri: attachment.localUri, durationSeconds: attachment.durationSeconds,
    }]);
    setMode('text');
  }, [att.setAttachments]);
  const onRecorded = useCallback(async (attachment: WireAttachment) => {
    const refs = contextRefs;
    try {
      if (await onSend('', [attachment], refs.length ? refs : undefined)) {
        onContextRefsChange([]);
        return;
      }
    } catch {
      onRecordingDraft(attachment);
      setSnack(cm.voiceSendFailed);
      return;
    }
    onRecordingDraft(attachment);
  }, [cm.voiceSendFailed, contextRefs, onContextRefsChange, onRecordingDraft, onSend]);
  const onTranscribed = useCallback((text: string) => {
    const current = draftRef.current.trim();
    updateDraft(current ? `${current} ${text}` : text);
    setMode('text');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [updateDraft]);
  const call = useVoiceCall();
  const callInChat = call.phase !== 'idle' && call.target?.conversationId === conversationId;
  const voice = useChatVoiceRecording({
    conversationId, disabled: mode !== 'voice' || runBusy || call.phase !== 'idle',
    onRecorded, onTranscribed, onRecordingDraft, onError: setSnack,
  });
  const voiceInteractionActive = voice.stage !== 'idle';

  const resetEditor = useCallback(() => {
    setDraft('');
    setCursorPos(0);
    setInputHeight(MIN_COMPOSER_INPUT_HEIGHT);
  }, []);

  useEffect(() => {
    const normalizedConversationId = conversationId.trim();
    restoredDraftConversationIdRef.current = normalizedConversationId;
    skipDraftPersistConversationIdRef.current = normalizedConversationId;

    if (!normalizedConversationId) {
      resetEditor();
      onContextRefsChange([]);
      return;
    }

    const snapshot = readComposerDraftSnapshot(normalizedConversationId);
    att.restoreAttachments(snapshot?.workspaceFiles ?? []);
    if (!snapshot) {
      resetEditor();
      onContextRefsChange([]);
      return;
    }

    setDraft(snapshot.text);
    setCursorPos(snapshot.cursorPos);
    setInputHeight(estimateComposerInputHeight(snapshot.text));
    setMode('text');
    onContextRefsChange(snapshot.contextRefs);
  }, [att.restoreAttachments, onContextRefsChange, resetEditor, conversationId]);

  useEffect(() => {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) return;
    if (restoredDraftConversationIdRef.current !== normalizedConversationId) return;
    if (skipDraftPersistConversationIdRef.current === normalizedConversationId) {
      skipDraftPersistConversationIdRef.current = null;
      return;
    }

    writeComposerDraftSnapshot(normalizedConversationId, { text: draft, cursorPos, contextRefs,
      workspaceFiles: att.attachments.filter(file => Boolean(file.workspaceRelativePath) && !file.content && !file.uri && !file.localUri),
    });
  }, [att.attachments, contextRefs, cursorPos, draft, conversationId]);

  const isExpanded = useMemo(
    () =>
      draft.length > 0 ||
      att.attachments.length > 0 ||
      contextRefs.length > 0 ||
      palette.open ||
      atPicker.open,
    [atPicker.open, draft.length, att.attachments.length, contextRefs.length, palette.open],
  );

  useEffect(() => {
    if (streaming) setMode('text');
  }, [streaming]);

  useEffect(() => {
    if (draft.length > 0) return;
    setInputHeight(MIN_COMPOSER_INPUT_HEIGHT);
  }, [draft.length]);

  /** Typing updates draft only; cursor comes from TextInput selection events. */
  const onDraftInputChange = useCallback(
    (nextDraft: string) => {
      setDraft(nextDraft);
      setInputHeight(estimateComposerInputHeight(nextDraft, inputWidth || undefined));
    },
    [inputWidth],
  );

  const gatewayId = useGatewayStore(state => state.activeGatewayId);
  const handoff = useComposerHandoff(state => state.pending);
  useFocusEffect(useCallback(() => {
    if (!gatewayId || !conversationId || !handoff) return;
    const text = useComposerHandoff.getState().consume(gatewayId, conversationId, mainConversation);
    if (text) {
      setMode('text');
      setDraft(current => current ? `${current}\n\n${text}` : text);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [conversationId, gatewayId, handoff, mainConversation]));

  useEffect(() => {
    if (suggestionDraft == null || suggestionDraft === '') return;
    updateDraft(suggestionDraft);
    setMode('text');
    onConsumeSuggestionDraft?.();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [suggestionDraft, onConsumeSuggestionDraft, updateDraft]);

  const canSendIdle = hasDraft && !disabled && !voiceInteractionActive && !callInChat;

  const handlePaletteSelect = useCallback(
    (item: import('./command-palette.types').PaletteItem) => {
      updateDraft(palette.applyItem(item));
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [palette, updateDraft],
  );

  const handleAtMentionSelect = useCallback((item: MobileAtMentionItem) => {
    const range = atPicker.range;
    if (!range) return;
    if (item.kind === 'note') {
      if (!contextRefs.some((ref) => ref.kind === 'note' && ref.sourceId === item.id) && contextRefs.length >= MAX_COMPOSER_CONTEXT_REFS) {
        setSnack(cm.contextLimitReached);
        return;
      } else if (!contextRefs.some((ref) => ref.kind === 'note' && ref.sourceId === item.id)) {
        onContextRefsChange([...contextRefs, {
          kind: 'note',
          sourceId: item.id,
          expectedVersion: item.expectedVersion,
          title: item.name,
        }]);
      }
      updateDraft(replaceAtMention(draft, range, ' '), range.start + 1);
    } else {
      const path = item.isDirectory && !item.relativePath.endsWith('/') ? `${item.relativePath}/` : item.relativePath;
      const token = `@file:${formatWorkspacePath(path)} `;
      updateDraft(replaceAtMention(draft, range, token), range.start + token.length);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [atPicker.range, cm.contextLimitReached, contextRefs, draft, onContextRefsChange, updateDraft]);

  const handleReferenceSelect = (item: ComposerReferenceItem) => {
    if (disabled || voiceInteractionActive) return;
    if (item.kind === 'file') {
      if (att.attachments.length >= att.maxAttachments || !item.relativePath) return;
      if (!att.attachments.some(file => file.workspaceRelativePath === item.relativePath)) {
        att.setAttachments([...att.attachments, {
          id: item.id, type: 'document', name: item.title,
          mimeType: item.mimeType || 'application/octet-stream', size: item.size || 0,
          content: '', workspaceRelativePath: item.relativePath,
        }]);
      }
    } else {
      if (contextRefs.some(ref => ref.kind === item.kind && ref.kind === 'note' && ref.sourceId === item.id)) return;
      if (contextRefs.length >= MAX_COMPOSER_CONTEXT_REFS) {
        setReferenceKind(null);
        setSnack(cm.contextLimitReached);
        return;
      }
      onContextRefsChange([...contextRefs, {
        kind: item.kind, sourceId: item.id, expectedVersion: item.version, title: item.title || cm.references.untitled,
      }]);
    }
    setReferenceKind(null);
    setMode('text');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSend = useCallback((delivery: 'next' | 'steer' = 'next') => {
    if (!canSendIdle) return;

    const previousDraft = draft;
    const previousAttachments = att.attachments;
    const previousContextRefs = contextRefs;
    const input = prepareComposerInput(previousDraft, att.toWirePayload());

    resetEditor();
    att.clearAttachments();
    onContextRefsChange([]);
    onCloseActions();

    void onSend(
      input.text,
      input.attachments.length ? input.attachments : undefined,
      previousContextRefs.length ? previousContextRefs : undefined,
      delivery,
    )
      .then((accepted) => {
        if (accepted) {
          if (!draftRef.current && !att.toWirePayload().length && !contextRefsRef.current.length) {
            clearComposerDraftSnapshot(conversationId);
          }
          return;
        }
        updateDraft(previousDraft);
        att.restoreAttachments(previousAttachments);
        onContextRefsChange(previousContextRefs);
        requestAnimationFrame(() => inputRef.current?.focus());
      })
      .catch(() => {
        updateDraft(previousDraft);
        att.restoreAttachments(previousAttachments);
        onContextRefsChange(previousContextRefs);
        requestAnimationFrame(() => inputRef.current?.focus());
      });
  }, [att, canSendIdle, contextRefs, draft, onContextRefsChange, onSend, resetEditor, onCloseActions, conversationId, updateDraft]);

  const handleAbort = useCallback(() => {
    onAbort();
  }, [onAbort]);

  const onContentSizeChange = useCallback(
    (e: { nativeEvent: { contentSize: { height: number } } }) => {
      const measured = e.nativeEvent.contentSize.height;
      if (!draft.includes('\n') && draft.trim().length === 0) {
        setInputHeight(MIN_COMPOSER_INPUT_HEIGHT);
        return;
      }
      setInputHeight(clampComposerInputHeight(measured));
    },
    [draft],
  );

  const handleInputLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextInputWidth = event.nativeEvent.layout.width;
      setInputWidth(nextInputWidth);
      if (draft.length > 0) {
        setInputHeight(estimateComposerInputHeight(draft, nextInputWidth));
      }
    },
    [draft],
  );

  const router = useRouter();
  const surface = colors.surface.elevated;
  const border = colors.border.default;
  const accent = colors.accent.primary;
  const shellBorder = isExpanded || mode === 'voice' ? colors.border.strong : border;
  const voiceToggleDisabled = disabled || streaming || voiceInteractionActive || call.phase !== 'idle';
  const toggleMode = useCallback(() => {
    if (voiceToggleDisabled) return;
    onCloseActions();
    if (mode === 'voice') {
      setMode('text');
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      inputRef.current?.blur();
      Keyboard.dismiss();
      setMode('voice');
    }
  }, [mode, onCloseActions, voiceToggleDisabled]);

  const openActionSheet = useCallback(() => {
    if (disabled || voiceInteractionActive) return;
    if (actionsOpen) {
      onCloseActions();
      return;
    }
    inputRef.current?.blur();
    Keyboard.dismiss();
    onActionsOpenChange(true);
  }, [actionsOpen, onActionsOpenChange, onCloseActions, disabled, voiceInteractionActive]);

  const handleAttachmentPick = useCallback(
    async (source: Parameters<typeof att.addFromSource>[0]) => {
      const added = await att.addFromSource(source);
      if (!added) return;
      setMode('text');
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [att],
  );

  const captureItems = useMemo(
    () => [
      { key: 'camera', icon: 'camera-outline', label: cm.takePhoto, onPress: () => void handleAttachmentPick('camera') },
      { key: 'photos', icon: 'image-outline', label: cm.photos, onPress: () => void handleAttachmentPick('photos') },
      { key: 'document', icon: 'folder-outline', label: cm.localFiles, onPress: () => void handleAttachmentPick('document') },
    ],
    [cm.localFiles, cm.photos, cm.takePhoto, handleAttachmentPick],
  );

  const attachmentPickDisabled = disabled || streaming || voiceInteractionActive || att.attachments.length >= att.maxAttachments;
  const sheetItems = [
    ...captureItems.map(item => ({ ...item, disabled: attachmentPickDisabled })),
    ...(call.phase === 'idle' ? COMPOSER_VOICE_CALL_OPTIONS.map(option => ({
      key: option.key,
      icon: option.icon,
      label: option.mode === 'natural' ? m.voice.realtimeCall : m.voice.assistantCall,
      description: option.mode === 'natural' ? m.voice.realtimeCallHint : m.voice.assistantCallHint,
      disabled: disabled || streaming || voiceInteractionActive || voiceCallUnavailable?.[option.mode] === true,
      onPress: () => onVoiceCallStart(option.mode),
    })) : []),
    { key: 'reference-note', icon: 'notebook-outline', label: cm.references.addNote, onPress: () => setReferenceKind('note') },
    { key: 'reference-task', icon: 'checkbox-marked-circle-outline', label: cm.references.addTask, onPress: () => setReferenceKind('task') },
    { key: 'reference-file', icon: 'folder-outline', label: cm.references.addFile, onPress: () => setReferenceKind('file') },
    { key: 'new-chat', icon: 'square-edit-outline', label: m.drawer.newChat,
      disabled: disabled || voiceInteractionActive,
      onPress: () => { Keyboard.dismiss(); onNewChat(); } },
    { key: 'meeting-recording', icon: 'microphone-plus', label: m.recordings.title,
      onPress: () => { Keyboard.dismiss(); router.push('/recordings'); } },
  ];

  const renderVoiceToggle = () => (
    <Pressable
      style={({ pressed }) => [
        styles.toolBtn,
        {
          backgroundColor: pressed ? colors.surface.hover : colors.surface.input,
          opacity: voiceToggleDisabled ? 0.54 : 1,
        },
      ]}
      onPress={toggleMode}
      disabled={voiceToggleDisabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={mode === 'text' ? cm.switchToVoice : cm.switchToKeyboard}
    >
      <Icon
        source={mode === 'text' ? 'microphone-outline' : 'keyboard-outline'}
        size={22}
        color={voiceToggleDisabled ? colors.text.tertiary : accent}
      />
    </Pressable>
  );

  const renderMoreButton = () => (
    <Pressable
      style={({ pressed }) => [
        styles.toolBtn,
        {
          backgroundColor: pressed ? colors.surface.hover : colors.surface.input,
          opacity: disabled || voiceInteractionActive ? 0.54 : 1,
        },
      ]}
      onPress={openActionSheet}
      disabled={disabled || voiceInteractionActive}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={cm.moreActions}
      accessibilityState={{ expanded: actionsOpen }}
    >
      <Icon
        source={actionsOpen ? "close-circle-outline" : "plus-circle-outline"}
        size={24}
        color={disabled ? colors.text.tertiary : accent}
      />
    </Pressable>
  );

  const renderAbortButton = () => (
    <Pressable
      style={[styles.sendCircle, { backgroundColor: colors.text.primary }]}
      onPress={handleAbort}
      hitSlop={8}
      accessibilityLabel={cm.stop}
    >
      <Icon source="stop" size={20} color={colors.text.inverse} />
    </Pressable>
  );

  const renderStreamingRightActions = () => (
    <View style={styles.streamingActions}>
      {hasDraft ? <Pressable style={[styles.sendCircle, { backgroundColor: colors.text.primary }]} onPress={() => handleSend()} disabled={!canSendIdle} accessibilityRole="button" accessibilityLabel={m.mobileExperience.sendNext}>
        <Icon source="arrow-up" size={22} color={colors.text.inverse} />
      </Pressable> : renderMoreButton()}
      {renderAbortButton()}
    </View>
  );

  const needsMultiline =
    isExpanded && (draft.includes('\n') || inputHeight > MIN_COMPOSER_INPUT_HEIGHT);
  const singleLineExpanded = isExpanded && !needsMultiline;

  const composerPlaceholder = placeholder ?? cm.inputPlaceholder;

  const renderSendOrStop = () => {
    if (streaming) return renderStreamingRightActions();
    if (!hasDraft || !isExpanded) return null;
    return (
      <Pressable
        style={[styles.sendCircle, { backgroundColor: canSendIdle ? colors.text.primary : colors.surface.active }]}
        onPress={() => handleSend()}
        disabled={!canSendIdle}
        hitSlop={8}
        accessibilityLabel={cm.send}
      >
        <Icon source="arrow-up" size={22} color={colors.text.inverse} />
      </Pressable>
    );
  };

  const textInputProps = {
    placeholder: composerPlaceholder,
    placeholderTextColor: colors.text.tertiary,
    value: draft,
    onChangeText: onDraftInputChange,
    onCursorChange: setCursorPos,
    cursorPos,
    multiline: true,
    editable: !disabled,
    onContentSizeChange,
    blurOnSubmit: false,
    returnKeyType: 'default' as const,
    textAlignVertical: (singleLineExpanded || !isExpanded
      ? 'center'
      : Platform.OS === 'android'
        ? 'top'
        : 'center') as 'top' | 'center',
    autoCapitalize: 'sentences' as const,
    onFocus: onCloseActions,
    onPressIn: onCloseActions,
  };

  const contextNotice = att.snack || snack;
  const dismissContextNotice = () => {
    if (att.snack) att.dismissSnack();
    if (snack) setSnack('');
  };

  return (
    <View style={styles.wrap}>
      <View onStartShouldSetResponderCapture={() => {
        onCloseActions();
        return false;
      }}>
      {streaming && hasDraft ? <View style={styles.deliveryHint}>
        <Text style={[typography.caption, { color: colors.text.secondary, flex: 1 }]}>{m.mobileExperience.queueHint}</Text>
        <Pressable accessibilityRole="button" disabled={!canSendIdle} onPress={() => handleSend('steer')} style={styles.steerButton}>
          <Text style={[typography.caption, { color: colors.accent.primary }]}>{m.mobileExperience.steer}</Text>
        </Pressable>
      </View> : null}
      {callInChat && <Text style={{ color: colors.text.secondary }}>{m.voice.finishCallToSend}</Text>}
      <VoiceRecordingCard
        visible={voiceInteractionActive}
        processing={voice.stage === 'starting' || voice.stage === 'stopping' || voice.stage === 'transcribing'}
        cancelled={voice.destination === 'cancel'}
        meterSamples={voice.samples}
        durationMillis={voice.durationMillis}
        hint={voice.stage === 'starting' ? cm.voiceStarting
          : voice.stage === 'stopping' ? cm.voiceSending
          : voice.stage === 'transcribing' ? cm.voiceTranscribing
          : voice.destination === 'cancel' ? cm.voiceReleaseCancelHint
          : voice.destination === 'text' ? cm.voiceReleaseTextHint : cm.voiceReleaseCenterHint}
      />

      {palette.open ? (
        <CommandPaletteBar
          items={palette.items}
          query={palette.query}
          loading={palette.loading}
          onSelect={handlePaletteSelect}
        />
      ) : null}

      {atPicker.open ? (
        <AtMentionPaletteBar
          items={atPicker.items}
          loading={atPicker.loading}
          emptyLabel={cm.contextSearchEmpty}
          onSelect={handleAtMentionSelect}
        />
      ) : null}

      {contextNotice ? (
        <View
          style={[
            styles.contextNotice,
            {
              backgroundColor: colors.surface.input,
              borderColor: colors.semantic.warning,
            },
          ]}
          accessibilityRole="alert"
        >
          <Icon source="alert-circle-outline" size={16} color={colors.semantic.warning} />
          <Text style={[styles.contextNoticeText, { color: colors.text.secondary }]}>
            {contextNotice}
          </Text>
          <Pressable
            onPress={dismissContextNotice}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={m.common.close}
          >
            <Icon source="close" size={16} color={colors.text.tertiary} />
          </Pressable>
        </View>
      ) : null}

      {contextControl || contextRefs.length || att.attachments.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          directionalLockEnabled keyboardShouldPersistTaps="handled"
          style={styles.contextControl} contentContainerStyle={styles.contextRow}>
          {contextControl}
          <ComposerContextChips refs={contextRefs}
            onRemove={(sourceId, kind) => onContextRefsChange(contextRefs.filter(ref => ref.sourceId !== sourceId || ref.kind !== kind))} />
          <ComposerAttachmentStrip attachments={att.attachments}
            onRemove={att.removeAttachment} onReplace={att.replaceAttachment}
            removeLabel={cm.removeAttachment} editLabel={cm.editImage} />
        </ScrollView>
      ) : null}
      </View>

      <View
        style={[
          styles.shell,
          elevation.raised,
          { backgroundColor: surface, borderColor: shellBorder },
        ]}
      >
        {mode === 'text' ? (
          <>
            <View style={isExpanded ? undefined : styles.compactRow}>
              {!isExpanded ? renderVoiceToggle() : null}
              <View
                style={isExpanded ? styles.expandedInput : styles.compactInputWrap}
                onLayout={handleInputLayout}
              >
                <SlashTokenInput
                  ref={inputRef}
                  style={[
                    styles.input,
                    isExpanded ? styles.inputExpanded : styles.inputCompact,
                    {
                      color: colors.text.primary,
                      ...(singleLineExpanded
                        ? { height: MIN_COMPOSER_INPUT_HEIGHT }
                        : isExpanded
                          ? { minHeight: inputHeight }
                          : { height: MIN_COMPOSER_INPUT_HEIGHT }),
                    },
                  ]}
                  {...textInputProps}
                />
              </View>
              {!isExpanded ? (streaming ? renderStreamingRightActions() : renderMoreButton()) : null}
            </View>
            {isExpanded ? (
              <View style={styles.toolRow}>
                {renderVoiceToggle()}
                <View style={styles.toolSpacer} />
                {streaming ? (
                  renderStreamingRightActions()
                ) : (
                  <>
                    {renderMoreButton()}
                    {renderSendOrStop()}
                  </>
                )}
              </View>
            ) : null}
          </>
        ) : isExpanded ? (
          <>
            <View
              style={[
                styles.holdPad,
                styles.holdPadExpanded,
                {
                  backgroundColor: voiceInteractionActive ? colors.surface.active : colors.surface.input,
                  borderColor: colors.border.subtle,
                },
              ]}
              {...voice.panHandlers}
            >
              <Text style={[styles.holdLabel, { color: colors.text.secondary }]}>
                {cm.holdToSpeak}
              </Text>
            </View>
            <View style={styles.toolRow}>
              {renderVoiceToggle()}
              <View style={styles.toolSpacer} />
              {streaming ? (
                renderStreamingRightActions()
              ) : (
                <>
                  {renderMoreButton()}
                  {renderSendOrStop()}
                </>
              )}
            </View>
          </>
        ) : (
          <View style={styles.compactRow}>
            {renderVoiceToggle()}
            <View
              style={[
                styles.holdPad,
                styles.holdPadCompact,
                {
                  backgroundColor: voiceInteractionActive ? colors.surface.active : colors.surface.input,
                  borderColor: colors.border.subtle,
                },
              ]}
              {...voice.panHandlers}
            >
              <Text style={[styles.holdLabel, { color: colors.text.secondary }]}>
                {cm.holdToSpeak}
              </Text>
            </View>
            {streaming ? renderStreamingRightActions() : renderMoreButton()}
          </View>
        )}
        <ComposerActionPanel key={conversationId} visible={actionsOpen} items={sheetItems} onClose={onCloseActions} />
      </View>
      {referenceKind && <ComposerReferenceSheet key={conversationId} initialKind={referenceKind} conversationId={conversationId}
        selectedIds={[...contextRefs.map(ref => `${ref.kind}:${ref.sourceId}`), ...att.attachments.map(file => `file:${file.id}`)]}
        onClose={() => setReferenceKind(null)} onSelect={handleReferenceSelect} filesDisabled={attachmentPickDisabled} referencesFull={contextRefs.length >= MAX_COMPOSER_CONTEXT_REFS}
        onLocalFile={() => { setReferenceKind(null); requestAnimationFrame(() => void handleAttachmentPick('document')); }} />}

    </View>
  );
});

const styles = StyleSheet.create({
  deliveryHint: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm },
  steerButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  wrap: {
    paddingHorizontal: spacing.content,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xxl,
    overflow: 'hidden',
  },
  contextNotice: {
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  contextNoticeText: {
    ...typography.caption,
    flex: 1,
    lineHeight: 18,
  },
  contextControl: { flexGrow: 0, marginBottom: spacing.sm },
  contextRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  expandedInput: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 0,
  },
  compactInputWrap: {
    flex: 1,
    justifyContent: 'center',
    height: MIN_COMPOSER_INPUT_HEIGHT,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    paddingTop: 0,
    gap: spacing.xs,
  },
  toolSpacer: {
    flex: 1,
  },
  toolBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCircle: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streamingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    ...typography.body,
    paddingHorizontal: 4,
    paddingVertical: Platform.select({ ios: 5, android: 4, default: 4 }),
    maxHeight: MAX_COMPOSER_INPUT_HEIGHT,
    borderWidth: 0,
    ...(Platform.OS === 'android' ? { includeFontPadding: false as const } : null),
  },
  inputCompact: {
    flex: 1,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  inputExpanded: {
    alignSelf: 'stretch',
  },
  holdPad: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  holdPadCompact: {
    flex: 1,
    minHeight: MIN_COMPOSER_INPUT_HEIGHT,
    marginVertical: 1,
  },
  holdPadExpanded: {
    minHeight: 44,
    marginHorizontal: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  holdLabel: {
    ...typography.body,
    fontWeight: '600',
  },
});
