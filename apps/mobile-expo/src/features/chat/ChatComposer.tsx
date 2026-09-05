/**
 * Chat composer — Kimi-style compact/expanded input, attachments, editable dictation and persistent calls.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  DeviceEventEmitter,
  useWindowDimensions,
  Modal,
  ScrollView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type View as RNView,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { Button, Icon } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessages } from '../../i18n/messages';
import { motion } from '../../motion';
import { radii, spacing, typography, useTheme } from '../../theme';
import { useOptionalWorkspaceTransition } from '../workspace/workspace-transition-context';
import { detectAtMentionRange, formatWorkspacePath, replaceAtMention } from './at-mention-utils';
import { canSendComposerDraft } from './composer-send-helpers';
import {
  MAX_COMPOSER_CONTEXT_REFS,
  type ComposerContextRef,
  type WireAttachment,
} from './composer.types';
import { AttachmentSourceSheet } from './attachment-source-sheet';
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
import { MOBILE_COMPOSER_APPEND_EVENT, MOBILE_COMPOSER_FILL_EVENT } from './mobile-composer-fill';
import { useChatDictation } from './use-chat-dictation';
import { useVoiceCall, voiceCall } from '../voice/voice-call';
import { useVoicePreferences } from '../voice/voice-preferences';
import { voiceErrorMessage } from '../voice/voice-error';
import { useGatewayStore } from '../../stores/gateway-store';

export const ChatComposer = memo(function ChatComposer({
  sessionKey,
  disabled,
  streaming,
  onSend,
  onAbort,
  placeholder,
  suggestionDraft,
  onConsumeSuggestionDraft,
  keyboardVisible = false,
  overlayShell = false,
  contextRefs,
  onContextRefsChange,
}: {
  sessionKey: string;
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string, attachments?: WireAttachment[], contextRefs?: ComposerContextRef[]) => Promise<boolean>;
  onAbort: () => void;
  placeholder?: string;
  suggestionDraft?: string;
  onConsumeSuggestionDraft?: () => void;
  keyboardVisible?: boolean;
  overlayShell?: boolean;
  contextRefs: ComposerContextRef[];
  onContextRefsChange: (refs: ComposerContextRef[]) => void;
}) {
  const m = useMessages();
  const { height } = useWindowDimensions();
  const cm = m.chat;
  const { colors } = useTheme();
  const transition = useOptionalWorkspaceTransition();
  const shellRef = useRef<RNView>(null);

  const [draft, setDraft] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_COMPOSER_INPUT_HEIGHT);
  const [inputWidth, setInputWidth] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const fillSubscription = DeviceEventEmitter.addListener(
      MOBILE_COMPOSER_FILL_EVENT,
      (text: unknown) => {
        if (typeof text !== 'string') return;
        setDraft(text);
        setCursorPos(text.length);
        requestAnimationFrame(() => inputRef.current?.focus());
      },
    );
    const appendSubscription = DeviceEventEmitter.addListener(
      MOBILE_COMPOSER_APPEND_EVENT,
      (text: unknown) => {
        if (typeof text !== 'string') return;
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
  }, []);

  const measureShell = useCallback(async () => {
    return new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
      shellRef.current?.measureInWindow((x, y, width, height) => {
        if (width <= 0 || height <= 0) {
          resolve(null);
          return;
        }
        resolve({ x, y, width, height });
      });
    });
  }, []);

  useEffect(() => {
    if (!overlayShell || !transition) return;
    transition.registerComposerMeasurer(measureShell);
    return () => transition.registerComposerMeasurer(null);
  }, [measureShell, overlayShell, transition]);

  const shellRevealStyle = useAnimatedStyle(() => {
    if (!overlayShell || !transition) return { opacity: 1 };
    const t = transition.progress.value;
    return {
      opacity: interpolate(
        t,
        [0, motion.hero.revealComposerAt, 1],
        [0, 0, 1],
        Extrapolation.CLAMP,
      ),
    };
  }, [overlayShell, transition]);

  const att = useComposerAttachments({
    maxAttachmentsReached: cm.maxAttachmentsReached,
    maxAttachmentsTruncated: cm.maxAttachmentsTruncated,
    attachmentFileTooLarge: cm.attachmentFileTooLarge,
    attachmentLoadFailed: cm.attachmentLoadFailed,
    attachmentPermissionDenied: cm.attachmentPermissionDenied,
    attachmentCameraPermissionDenied: cm.attachmentCameraPermissionDenied,
  });

  const atRangeActive = detectAtMentionRange(draft, cursorPos) !== null;
  const palette = useCommandPalette(draft, cursorPos, atRangeActive);
  const atPicker = useAtMentionPicker(draft, cursorPos, sessionKey, palette.open);

  const [snack, setSnack] = useState('');
  const restoredDraftSessionKeyRef = useRef<string | null>(null);
  const skipDraftPersistSessionKeyRef = useRef<string | null>(null);
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
  const dictationCursor = useRef(0);
  const dictationDraft = useRef('');
  const insets = useSafeAreaInsets();
  const [pendingTranscript, setPendingTranscript] = useState('');
  useEffect(() => setPendingTranscript(''), [sessionKey]);
  const onTranscribed = useCallback((text: string) => {
    const current = draftRef.current;
    if (current !== dictationDraft.current) { setPendingTranscript(text); return; }
    const position = Math.min(dictationCursor.current, current.length);
    const next = current.slice(0, position) + text + current.slice(position);
    updateDraft(next, position + text.length);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [updateDraft]);
  const voice = useChatDictation(sessionKey, onTranscribed);
  const voiceInteractionActive = voice.phase !== 'idle';
  const call = useVoiceCall();
  const callInChat = call.phase !== 'idle' && call.target?.sessionKey === sessionKey;
  const gatewayId = useGatewayStore(s => s.activeGatewayId);
  const voicePrefs = useVoicePreferences();
  const startCall = () => {
    if (call.phase !== 'idle') { voiceCall.expand(); return; }
    if (!gatewayId || runBusy || disabled || voiceInteractionActive) return;
    void voiceCall.start({ gatewayId, sessionKey, engine: voicePrefs.engines[gatewayId], background: voicePrefs.background });
  };

  const resetEditor = useCallback(() => {
    setDraft('');
    setCursorPos(0);
    setInputHeight(MIN_COMPOSER_INPUT_HEIGHT);
  }, []);

  useEffect(() => {
    const normalizedSessionKey = sessionKey.trim();
    restoredDraftSessionKeyRef.current = normalizedSessionKey;
    skipDraftPersistSessionKeyRef.current = normalizedSessionKey;

    if (!normalizedSessionKey) {
      resetEditor();
      onContextRefsChange([]);
      return;
    }

    const snapshot = readComposerDraftSnapshot(normalizedSessionKey);
    if (!snapshot) {
      resetEditor();
      onContextRefsChange([]);
      return;
    }

    setDraft(snapshot.text);
    setCursorPos(snapshot.cursorPos);
    setInputHeight(estimateComposerInputHeight(snapshot.text));
    onContextRefsChange(snapshot.contextRefs);
  }, [onContextRefsChange, resetEditor, sessionKey]);

  useEffect(() => {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) return;
    if (restoredDraftSessionKeyRef.current !== normalizedSessionKey) return;
    if (skipDraftPersistSessionKeyRef.current === normalizedSessionKey) {
      skipDraftPersistSessionKeyRef.current = null;
      return;
    }

    writeComposerDraftSnapshot(normalizedSessionKey, { text: draft, cursorPos, contextRefs });
  }, [contextRefs, cursorPos, draft, sessionKey]);

  const isExpanded = useMemo(
    () =>
      isFocused ||
      draft.length > 0 ||
      att.attachments.length > 0 ||
      contextRefs.length > 0 ||
      keyboardVisible ||
      palette.open ||
      atPicker.open,
    [atPicker.open, isFocused, draft.length, att.attachments.length, contextRefs.length, keyboardVisible, palette.open],
  );

  useEffect(() => {
    if (!isFocused || draft.length > 0) return;
    setInputHeight(MIN_COMPOSER_INPUT_HEIGHT);
  }, [isFocused, draft.length]);

  /** Typing updates draft only; cursor comes from TextInput selection events. */
  const onDraftInputChange = useCallback(
    (nextDraft: string) => {
      setDraft(nextDraft);
      setInputHeight(estimateComposerInputHeight(nextDraft, inputWidth || undefined));
    },
    [inputWidth],
  );

  useEffect(() => {
    if (suggestionDraft == null || suggestionDraft === '') return;
    updateDraft(suggestionDraft);
    onConsumeSuggestionDraft?.();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [suggestionDraft, onConsumeSuggestionDraft, updateDraft]);

  const canSendIdle = hasDraft && !runBusy && !voiceInteractionActive && !callInChat;

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
      if (!contextRefs.some((ref) => ref.sourceId === item.id) && contextRefs.length >= MAX_COMPOSER_CONTEXT_REFS) {
        setSnack(cm.contextLimitReached);
        return;
      } else if (!contextRefs.some((ref) => ref.sourceId === item.id)) {
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

  const handleSend = useCallback(() => {
    if (!canSendIdle || runBusy) return;

    const previousDraft = draft;
    const previousAttachments = att.attachments;
    const previousContextRefs = contextRefs;
    const wire = att.toWirePayload();

    resetEditor();
    att.clearAttachments();
    onContextRefsChange([]);
    inputRef.current?.blur();

    void onSend(
      previousDraft.trim(),
      wire.length ? wire : undefined,
      previousContextRefs.length ? previousContextRefs : undefined,
    )
      .then((accepted) => {
        if (accepted) {
          clearComposerDraftSnapshot(sessionKey);
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
  }, [att, canSendIdle, contextRefs, draft, onContextRefsChange, onSend, resetEditor, runBusy, sessionKey, updateDraft]);

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

  const surface = colors.surface.elevated;
  const border = colors.border.default;
  const accent = colors.accent.primary;
  const shellBorder = isExpanded ? colors.border.strong : border;
  const startDictation = () => {
    if (disabled || streaming || voiceInteractionActive || call.phase !== 'idle') return;
    dictationCursor.current = cursorPos;
    dictationDraft.current = draft;
    void voice.start();
  };

  const openAttachmentSheet = useCallback(() => {
    if (disabled || voiceInteractionActive) return;
    att.openSheet();
  }, [att, disabled, voiceInteractionActive]);

  const handleAttachmentPick = useCallback(
    async (source: Parameters<typeof att.addFromSource>[0]) => {
      const added = await att.addFromSource(source);
      if (!added) return;
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [att],
  );

  const sheetItems = useMemo(
    () => [
      { source: 'camera' as const, icon: 'camera-outline', label: cm.takePhoto },
      { source: 'photos' as const, icon: 'image-outline', label: cm.photos },
      { source: 'document' as const, icon: 'folder-outline', label: cm.localFiles },
    ],
    [cm.takePhoto, cm.photos, cm.localFiles],
  );

  const captureItems = useMemo(
    () => [
      { key: 'camera', icon: 'camera-outline', label: cm.takePhoto, onPress: () => void handleAttachmentPick('camera') },
      { key: 'photos', icon: 'image-outline', label: cm.photos, onPress: () => void handleAttachmentPick('photos') },
      { key: 'document', icon: 'folder-outline', label: cm.localFiles, onPress: () => void handleAttachmentPick('document') },
    ],
    [cm.localFiles, cm.photos, cm.takePhoto, handleAttachmentPick],
  );

  const renderCaptureChip = (
    key: string,
    icon: string,
    label: string,
    onPress: () => void,
    itemDisabled: boolean,
  ) => (
    <Pressable
      key={key}
      style={({ pressed }) => [
        styles.captureChip,
        {
          borderColor: colors.border.subtle,
          backgroundColor: pressed ? colors.surface.hover : colors.surface.panel,
          opacity: itemDisabled ? 0.45 : pressed ? 0.78 : 1,
        },
      ]}
      onPress={onPress}
      disabled={itemDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon source={icon} size={17} color={itemDisabled ? colors.text.tertiary : accent} />
      <Text style={[styles.captureLabel, { color: colors.text.primary }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );

  const renderCaptureRail = () => {
    return (
      <View style={styles.captureRail}>
        {captureItems.map((item) => {
          const itemDisabled = disabled
            || streaming
            || voiceInteractionActive
            || att.attachments.length >= att.maxAttachments;
          return renderCaptureChip(item.key, item.icon, item.label, item.onPress, itemDisabled);
        })}
      </View>
    );
  };

  const dictationDisabled = disabled || streaming || voiceInteractionActive || call.phase !== 'idle';
  const renderCallButton = (primary = false) => (
    <Pressable
      style={[primary ? styles.sendCircle : styles.toolBtn, primary && { backgroundColor: colors.accent.primary }, { opacity: call.phase === 'idle' && (runBusy || voiceInteractionActive) ? 0.54 : 1 }]}
      onPress={startCall}
      disabled={call.phase === 'idle' && (runBusy || voiceInteractionActive)}
      accessibilityRole="button"
      accessibilityLabel={call.phase === 'idle' ? m.voice.title : m.voice.expand}
    >
      <Icon source="phone-outline" size={22} color={primary ? colors.text.inverse : accent} />
    </Pressable>
  );

  const renderVoiceToggle = () => (
    <Pressable
      style={({ pressed }) => [
        styles.toolBtn,
        {
          backgroundColor: pressed ? colors.surface.hover : colors.surface.input,
          opacity: dictationDisabled ? 0.54 : 1,
        },
      ]}
      onPress={startDictation}
      disabled={dictationDisabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={m.voice.dictation}
    >
      <Icon
        source="microphone-outline"
        size={22}
        color={dictationDisabled ? colors.text.tertiary : accent}
      />
    </Pressable>
  );

  const renderAttachButton = () => (
    <Pressable
      style={({ pressed }) => [
        styles.toolBtn,
        {
          backgroundColor: pressed ? colors.surface.hover : colors.surface.input,
          opacity: disabled || voiceInteractionActive || att.attachments.length >= att.maxAttachments ? 0.54 : 1,
        },
      ]}
      onPress={openAttachmentSheet}
      disabled={disabled || voiceInteractionActive || att.attachments.length >= att.maxAttachments}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={cm.attachFile}
    >
      <Icon
        source="plus-circle-outline"
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
      {renderAttachButton()}
      {renderAbortButton()}
    </View>
  );

  const needsMultiline =
    isExpanded && (draft.includes('\n') || inputHeight > MIN_COMPOSER_INPUT_HEIGHT);
  const singleLineExpanded = isExpanded && !needsMultiline;

  const composerPlaceholder = placeholder ?? cm.inputPlaceholder;

  const renderSendOrStop = () => {
    if (streaming) return renderStreamingRightActions();
    if (!hasDraft) return renderCallButton(true);
    if (!isExpanded) return null;
    return (
      <Pressable
        style={[styles.sendCircle, { backgroundColor: canSendIdle ? colors.text.primary : colors.surface.active }]}
        onPress={handleSend}
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
    onFocus: () => setIsFocused(true),
    onBlur: () => setIsFocused(false),
  };

  const contextNotice = att.snack || snack;
  const dismissContextNotice = () => {
    if (att.snack) att.dismissSnack();
    if (snack) setSnack('');
  };

  return (
    <View style={[styles.wrap, { borderTopColor: 'transparent' }]}>
      <Modal visible={voiceInteractionActive} transparent animationType="slide" onRequestClose={voice.cancel}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.surface.base, paddingBottom: Math.max(insets.bottom, spacing.lg), paddingTop: insets.top }}>
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <Text style={[typography.heading, { color: colors.text.primary }]}>{m.voice.dictation}</Text>
            <Text style={{ color: colors.text.secondary }}>{m.voice.voiceInputHint}</Text>
            <Text style={{ color: colors.text.primary }}>{voice.phase === 'recording' ? m.voice.recording : voice.phase === 'error' ? voiceErrorMessage(voice.error, m.voice) : voice.phase === 'connecting' ? m.voice.connecting : m.voice.processing}</Text>
            {voice.startedAt > 0 && <Text style={{ color: colors.text.secondary }}>{Math.floor(voice.elapsed / 60)}:{String(voice.elapsed % 60).padStart(2, '0')}</Text>}
            <ScrollView style={{ maxHeight: height * 0.4 }}><Text style={{ color: colors.text.primary }}>{voice.text}</Text></ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Button onPress={voice.cancel}>{m.voice.cancel}</Button>
              <Button disabled={voice.phase !== 'recording' && !(voice.phase === 'error' && voice.text)} onPress={voice.phase === 'error' ? voice.insertExisting : voice.finish}>{voice.phase === 'error' ? m.voice.insert : m.voice.finish}</Button>
            </View>
          </View>
        </View>
      </Modal>
      {callInChat && <Text style={{ color: colors.text.secondary }}>{m.voice.finishCallToSend}</Text>}
      {pendingTranscript !== '' && <View style={{ gap: spacing.sm, padding: spacing.md }}>
        <Text style={{ color: colors.text.secondary }}>{m.voice.draftChanged}</Text>
        <Text style={{ color: colors.text.primary }} numberOfLines={4}>{pendingTranscript}</Text>
        <View style={{ flexDirection: 'row' }}>
          <Button onPress={() => setPendingTranscript('')}>{m.voice.cancel}</Button>
          <Button onPress={() => {
            updateDraft(draft + (draft ? '\n' : '') + pendingTranscript);
            setPendingTranscript('');
          }}>{m.voice.insert}</Button>
        </View>
      </View>}

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

      {att.attachments.length > 0 ? (
        <ComposerAttachmentStrip
          attachments={att.attachments}
          onRemove={att.removeAttachment}
          onReplace={att.replaceAttachment}
          removeLabel={cm.removeAttachment}
          editLabel={cm.editImage}
        />
      ) : null}

      <ComposerContextChips
        refs={contextRefs}
        onRemove={(sourceId) => onContextRefsChange(contextRefs.filter((ref) => ref.sourceId !== sourceId))}
      />

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

      {renderCaptureRail()}

      <Animated.View
        ref={shellRef}
        onLayout={() => {
          if (!overlayShell) return;
          void measureShell().then((rect) => {
            if (rect) transition?.notifyComposerAnchor(rect);
          });
        }}
        style={[
          styles.shell,
          styles.shellRaisedNative,
          { backgroundColor: surface, borderColor: shellBorder },
          shellRevealStyle,
        ]}
      >
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
              {!isExpanded ? (streaming ? renderStreamingRightActions() : <View style={styles.streamingActions}>{renderAttachButton()}{renderCallButton(true)}</View>) : null}
            </View>
            {isExpanded ? (
              <View style={styles.toolRow}>
                {renderVoiceToggle()}
                {hasDraft && !streaming ? renderCallButton() : null}
                <View style={styles.toolSpacer} />
                {streaming ? (
                  renderStreamingRightActions()
                ) : (
                  <>
                    {renderAttachButton()}
                    {renderSendOrStop()}
                  </>
                )}
              </View>
            ) : null}
          </>
      </Animated.View>

      <AttachmentSourceSheet
        visible={att.sheetOpen}
        items={sheetItems}
        onClose={att.closeSheet}
        onPick={(source) => void handleAttachmentPick(source)}
      />

    </View>
  );
});

const styles = StyleSheet.create({
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
  shellRaisedNative: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  captureRail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  captureChip: {
    flex: 1,
    minWidth: 0,
    height: 38,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  captureLabel: {
    ...typography.label,
    fontWeight: '600',
  },
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
    width: 34,
    height: 34,
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
});
