/**
 * Chat composer — Kimi-style compact/expanded input, attachments, text / voice modes.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type View as RNView,
} from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { Icon } from 'react-native-paper';

import { AppToast } from '../../components/AppToast';

import { TOAST_BOTTOM_LIFT_ABOVE_BAR, TOAST_DURATION_LONG } from '../../constants/toast';
import { useMessages } from '../../i18n/messages';
import { motion } from '../../motion';
import { transcribeVoice } from '../../api/agent-client';
import { radii, spacing, typography, useTheme } from '../../theme';
import { useOptionalWorkspaceTransition } from '../workspace/workspace-transition-context';
import { ChatPendingFollowUpStack } from './ChatPendingFollowUpStack';
import { canSendComposerDraft } from './composer-send-helpers';
import type { ComposerAttachment, WireAttachment } from './composer.types';
import type { PendingFollowUp } from './pending-follow-up.types';
import { wireFollowUpAttachmentsToComposer } from './follow-up-utils';
import { useComposerActions } from './use-composer-actions';
import { AttachmentSourceSheet } from './attachment-source-sheet';
import { ComposerAttachmentStrip } from './composer-attachment-strip';
import { CommandPaletteBar } from './CommandPaletteBar';
import { SlashTokenInput } from './SlashTokenInput';
import {
  clampComposerInputHeight,
  estimateComposerInputHeight,
  MAX_COMPOSER_INPUT_HEIGHT,
  MIN_COMPOSER_INPUT_HEIGHT,
} from './composer-layout';
import { useCommandPalette } from './useCommandPalette';
import {
  clearComposerDraftSnapshot,
  readComposerDraftSnapshot,
  writeComposerDraftSnapshot,
} from './composer-draft-storage';
import { useComposerAttachments } from './use-composer-attachments';
import { EMPTY_CHAT_GOAL_SHORTCUT } from './chat-empty-shortcuts';
import {
  VoiceRecordingOverlay,
  type VoiceRecordingZone,
} from './VoiceRecordingOverlay';
import {
  beginRecording,
  discardRecording,
  finishRecording,
  inferRecordingMimeType,
  meteringToLevel,
  requestMicPermission,
  type ExpoRecording,
} from './voiceRecording';

const ZONE_CANCEL_DX = -72;
const ZONE_TEXT_DX = 72;
const MIN_VOICE_MS = 380;

/** Center sends voice; swiping left cancels; swiping right converts to text. */
function voiceZoneFromGesture(dx: number): VoiceRecordingZone {
  if (dx < ZONE_CANCEL_DX) return 'cancel';
  if (dx > ZONE_TEXT_DX) return 'text';
  return 'center';
}

type InputMode = 'text' | 'voice';

export const ChatComposer = memo(function ChatComposer({
  sessionKey,
  disabled,
  streaming,
  onSend,
  onSendVoice,
  onAbort,
  placeholder,
  suggestionDraft,
  onConsumeSuggestionDraft,
  prefillAttachments,
  onConsumePrefillAttachments,
  keyboardVisible = false,
  onAddPendingFollowUp,
  pendingFollowUps = [],
  editingFollowUpId = null,
  onBeginEditFollowUp,
  onCancelEditFollowUp,
  onCommitEditFollowUp,
  onPendingFollowUpRemove,
  onPendingFollowUpMove,
  onPendingFollowUpSteer,
  steeringFollowUpId = null,
  onQueueFull,
  onPressGoalShortcut,
  overlayShell = false,
}: {
  sessionKey: string;
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string, attachments?: WireAttachment[]) => Promise<boolean>;
  onSendVoice?: (payload: { uri: string; durationMillis: number; mimeType?: string }) => void | Promise<void>;
  onAbort: () => void;
  placeholder?: string;
  suggestionDraft?: string;
  onConsumeSuggestionDraft?: () => void;
  prefillAttachments?: ComposerAttachment[];
  onConsumePrefillAttachments?: () => void;
  keyboardVisible?: boolean;
  onAddPendingFollowUp?: (text: string, attachments?: WireAttachment[]) => void | Promise<void>;
  pendingFollowUps?: PendingFollowUp[];
  editingFollowUpId?: string | null;
  onBeginEditFollowUp?: (id: string) => void;
  onCancelEditFollowUp?: () => void;
  onCommitEditFollowUp?: (
    id: string,
    text: string,
    attachments?: PendingFollowUp['attachments'],
  ) => void;
  onPendingFollowUpRemove?: (id: string) => void;
  onPendingFollowUpMove?: (id: string, dir: 'up' | 'down') => void;
  onPendingFollowUpSteer?: (id: string) => void;
  steeringFollowUpId?: string | null;
  onQueueFull?: () => void;
  onPressGoalShortcut?: () => void;
  overlayShell?: boolean;
}) {
  const m = useMessages();
  const cm = m.chat;
  const { colors, isDark } = useTheme();
  const transition = useOptionalWorkspaceTransition();
  const shellRef = useRef<RNView>(null);

  const [mode, setMode] = useState<InputMode>('text');
  const [draft, setDraft] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_COMPOSER_INPUT_HEIGHT);
  const [inputWidth, setInputWidth] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

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

  const palette = useCommandPalette(draft, cursorPos);

  const [hudOpen, setHudOpen] = useState(false);
  const [voiceZone, setVoiceZone] = useState<VoiceRecordingZone>('center');
  const [meterSamples, setMeterSamples] = useState<number[]>([]);
  const [snack, setSnack] = useState('');
  const [transcribing, setTranscribing] = useState(false);

  const recordingRef = useRef<ExpoRecording | null>(null);
  const readyRef = useRef(false);
  const abortStartRef = useRef(false);
  const cancelZoneRef = useRef(false);
  const releaseZoneRef = useRef<VoiceRecordingZone>('center');
  const grantInFlightRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const lastLoadedEditFollowUpIdRef = useRef<string | null>(null);
  const lastLoadedPrefillAttachmentsRef = useRef<ComposerAttachment[] | null>(null);
  const restoredDraftSessionKeyRef = useRef<string | null>(null);
  const skipDraftPersistSessionKeyRef = useRef<string | null>(null);

  const runBusy = streaming || disabled;
  const hasDraft = canSendComposerDraft(draft, att.attachments.length);

  const clearEditFollowUpRef = useCallback(() => {
    lastLoadedEditFollowUpIdRef.current = null;
  }, []);

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
      return;
    }

    const snapshot = readComposerDraftSnapshot(normalizedSessionKey);
    if (!snapshot) {
      resetEditor();
      return;
    }

    setDraft(snapshot.text);
    setCursorPos(snapshot.cursorPos);
    setInputHeight(estimateComposerInputHeight(snapshot.text));
    setMode('text');
  }, [resetEditor, sessionKey]);

  useEffect(() => {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) return;
    if (restoredDraftSessionKeyRef.current !== normalizedSessionKey) return;
    if (skipDraftPersistSessionKeyRef.current === normalizedSessionKey) {
      skipDraftPersistSessionKeyRef.current = null;
      return;
    }

    writeComposerDraftSnapshot(normalizedSessionKey, { text: draft, cursorPos });
  }, [cursorPos, draft, sessionKey]);

  const actions = useComposerActions({
    chat: cm,
    runBusy,
    voiceRecording: hudOpen || transcribing,
    stopVoiceRecording: () => {
      abortStartRef.current = true;
    },
    editingFollowUpId,
    getTextValue: () => draftRef.current,
    getAttachmentCount: () => att.attachments.length,
    wireAttachmentsPayload: att.toWirePayload,
    onSend: (text, attachments) => {
      void onSend(text, attachments);
    },
    onAddPendingFollowUp,
    onCommitEditFollowUp: onCommitEditFollowUp ?? (() => {}),
    onQueueFull,
    pendingFollowUpsCount: pendingFollowUps.length,
    resetEditor,
    clearAttachments: att.clearAttachments,
    clearEditFollowUpRef,
  });

  const isExpanded = useMemo(
    () =>
      isFocused ||
      draft.length > 0 ||
      att.attachments.length > 0 ||
      keyboardVisible ||
      palette.open,
    [isFocused, draft.length, att.attachments.length, keyboardVisible, palette.open],
  );

  useEffect(() => {
    if (streaming && mode === 'voice') {
      setMode('text');
    }
  }, [streaming, mode]);

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

  /** Programmatic draft updates (palette, suggestions, restore) set cursor explicitly. */
  const updateDraft = useCallback(
    (nextDraft: string, nextCursor = nextDraft.length) => {
      setDraft(nextDraft);
      setCursorPos(nextCursor);
      setInputHeight(estimateComposerInputHeight(nextDraft, inputWidth || undefined));
    },
    [inputWidth],
  );

  useEffect(() => {
    if (suggestionDraft == null || suggestionDraft === '') return;
    updateDraft(suggestionDraft);
    setMode('text');
    onConsumeSuggestionDraft?.();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [suggestionDraft, onConsumeSuggestionDraft, updateDraft]);

  useEffect(() => {
    if (!prefillAttachments?.length) return;
    if (prefillAttachments === lastLoadedPrefillAttachmentsRef.current) return;
    lastLoadedPrefillAttachmentsRef.current = prefillAttachments;
    att.restoreAttachments(prefillAttachments);
    setMode('text');
    onConsumePrefillAttachments?.();
  }, [att, onConsumePrefillAttachments, prefillAttachments]);

  useEffect(() => {
    if (!editingFollowUpId) {
      if (lastLoadedEditFollowUpIdRef.current) {
        att.clearAttachments();
        resetEditor();
        lastLoadedEditFollowUpIdRef.current = null;
      }
      return;
    }
    if (editingFollowUpId === lastLoadedEditFollowUpIdRef.current) return;
    const row = pendingFollowUps.find((r) => r.id === editingFollowUpId);
    if (!row) {
      onCancelEditFollowUp?.();
      return;
    }
    lastLoadedEditFollowUpIdRef.current = editingFollowUpId;
    att.setAttachments(wireFollowUpAttachmentsToComposer(row.attachments ?? []));
    updateDraft(row.text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [
    att,
    editingFollowUpId,
    onCancelEditFollowUp,
    pendingFollowUps,
    resetEditor,
    updateDraft,
  ]);

  const canSendIdle = hasDraft && !disabled && !runBusy;
  const canQueueWhileBusy = runBusy && hasDraft;

  const finalizeRecordingInteraction = useCallback(async () => {
    const rec = recordingRef.current;
    const shouldDiscard = cancelZoneRef.current;
    const releaseZone = releaseZoneRef.current;

    recordingRef.current = null;
    readyRef.current = false;
    abortStartRef.current = false;
    grantInFlightRef.current = false;
    cancelZoneRef.current = false;
    releaseZoneRef.current = 'center';
    setHudOpen(false);
    setVoiceZone('center');
    setMeterSamples([]);

    if (!rec) return;

    if (shouldDiscard) {
      await discardRecording(rec);
      return;
    }

    try {
      const { uri, durationMillis } = await finishRecording(rec);
      if (durationMillis < MIN_VOICE_MS) {
        setSnack(cm.voiceTooShort);
        return;
      }
      if (!uri) {
        setSnack(cm.voiceRecordingFailed);
        return;
      }

      const mimeType = inferRecordingMimeType(uri);

      if (releaseZone === 'text') {
        setTranscribing(true);
        try {
          const result = await transcribeVoice(uri, mimeType);
          const text = result.refined || result.raw;
          if (text.trim()) {
            const currentDraft = draftRef.current;
            const nextDraft = currentDraft.trim()
              ? `${currentDraft.trim()} ${text.trim()}`
              : text.trim();
            updateDraft(nextDraft);
            setMode('text');
            requestAnimationFrame(() => inputRef.current?.focus());
          } else {
            setSnack(cm.voiceNoSpeechDetected);
          }
        } catch {
          setSnack(cm.voiceTranscribeFailed);
        } finally {
          setTranscribing(false);
        }
        return;
      }

      if (onSendVoice) {
        await onSendVoice({ uri, durationMillis, mimeType });
        setMode('text');
      } else {
        setSnack(cm.voiceSendUnavailable);
      }
    } catch {
      setSnack(cm.voiceRecordingFailed);
    }
  }, [cm, onSendVoice, updateDraft]);

  const startGrantFlow = useCallback(() => {
    if (disabled || streaming || transcribing || grantInFlightRef.current) return;
    abortStartRef.current = false;
    readyRef.current = false;
    recordingRef.current = null;
    cancelZoneRef.current = false;
    releaseZoneRef.current = 'center';
    setVoiceZone('center');
    setMeterSamples([]);
    grantInFlightRef.current = true;

    if (Platform.OS === 'web') {
      grantInFlightRef.current = false;
      setSnack(cm.voiceWebUnsupported);
      return;
    }

    void (async () => {
      const ok = await requestMicPermission();
      if (!ok) {
        grantInFlightRef.current = false;
        setSnack(cm.voicePermissionDenied);
        return;
      }
      try {
        const rec = await beginRecording((metering) => {
          setMeterSamples((prev) => [...prev.slice(-47), meteringToLevel(metering)]);
        });
        if (abortStartRef.current) {
          await discardRecording(rec);
          grantInFlightRef.current = false;
          return;
        }
        recordingRef.current = rec;
        readyRef.current = true;
        grantInFlightRef.current = false;
        setHudOpen(true);
      } catch {
        grantInFlightRef.current = false;
        setSnack(cm.voiceRecordingFailed);
      }
    })();
  }, [cm, disabled, streaming, transcribing]);

  const canCaptureVoice = mode === 'voice' && !disabled && !streaming && !transcribing;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => canCaptureVoice,
        onMoveShouldSetPanResponder: () => canCaptureVoice,
        onPanResponderGrant: () => {
          cancelZoneRef.current = false;
          releaseZoneRef.current = 'center';
          setVoiceZone('center');
          startGrantFlow();
        },
        onPanResponderMove: (_, g) => {
          const zone = voiceZoneFromGesture(g.dx);
          cancelZoneRef.current = zone === 'cancel';
          releaseZoneRef.current = zone;
          setVoiceZone(zone);
        },
        onPanResponderRelease: () => {
          if (!readyRef.current) {
            abortStartRef.current = true;
            return;
          }
          void finalizeRecordingInteraction();
        },
        onPanResponderTerminate: () => {
          if (!readyRef.current) {
            abortStartRef.current = true;
            return;
          }
          cancelZoneRef.current = true;
          releaseZoneRef.current = 'center';
          setVoiceZone('cancel');
          void finalizeRecordingInteraction();
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [canCaptureVoice, finalizeRecordingInteraction, startGrantFlow],
  );

  const handlePaletteSelect = useCallback(
    (item: import('./command-palette.types').PaletteItem) => {
      updateDraft(palette.applyItem(item));
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [palette, updateDraft],
  );

  const handleSend = useCallback(() => {
    if (canQueueWhileBusy) {
      void actions.flushSteeringDraft();
      return;
    }
    if (!canSendIdle || runBusy) return;

    const previousDraft = draft;
    const previousAttachments = att.attachments;
    const wire = att.toWirePayload();

    resetEditor();
    att.clearAttachments();
    inputRef.current?.blur();

    void onSend(previousDraft.trim(), wire.length ? wire : undefined)
      .then((accepted) => {
        if (accepted) {
          clearComposerDraftSnapshot(sessionKey);
          return;
        }
        updateDraft(previousDraft);
        att.restoreAttachments(previousAttachments);
        requestAnimationFrame(() => inputRef.current?.focus());
      })
      .catch(() => {
        updateDraft(previousDraft);
        att.restoreAttachments(previousAttachments);
        requestAnimationFrame(() => inputRef.current?.focus());
      });
  }, [actions, att, canQueueWhileBusy, canSendIdle, draft, onSend, resetEditor, runBusy, sessionKey, updateDraft]);

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

  const surface = colors.surface.panel;
  const border = colors.border.default;
  const accent = colors.accent.primary;
  const shellBorder = isExpanded || mode === 'voice' ? colors.border.strong : border;

  const toggleMode = useCallback(() => {
    if (disabled || streaming || hudOpen || transcribing) return;
    setMode((prev) => (prev === 'text' ? 'voice' : 'text'));
  }, [disabled, streaming, hudOpen, transcribing]);

  const openAttachmentSheet = useCallback(() => {
    if (disabled) return;
    att.openSheet();
  }, [att, disabled]);

  const handleAttachmentPick = useCallback(
    async (source: Parameters<typeof att.addFromSource>[0]) => {
      const added = await att.addFromSource(source);
      if (!added) return;
      setMode('text');
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
    const goalLabel = m.chat.emptyShortcuts.goal;
    const goalDisabled = disabled || streaming;

    return (
      <View style={styles.captureRail}>
        {onPressGoalShortcut
          ? renderCaptureChip(
              'goal',
              EMPTY_CHAT_GOAL_SHORTCUT.icon,
              goalLabel,
              onPressGoalShortcut,
              goalDisabled,
            )
          : null}
        {captureItems.map((item) => {
          const itemDisabled = disabled || streaming || att.attachments.length >= att.maxAttachments;
          return renderCaptureChip(item.key, item.icon, item.label, item.onPress, itemDisabled);
        })}
      </View>
    );
  };

  const renderVoiceToggle = () => (
    <Pressable
      style={({ pressed }) => [
        styles.toolBtn,
        {
          backgroundColor: pressed ? colors.surface.hover : colors.surface.input,
          opacity: disabled || streaming ? 0.54 : 1,
        },
      ]}
      onPress={toggleMode}
      disabled={disabled || streaming}
      accessibilityLabel={mode === 'text' ? 'Switch to voice input' : 'Switch to keyboard'}
    >
      <Icon
        source={mode === 'text' ? 'microphone-outline' : 'keyboard-outline'}
        size={22}
        color={disabled || streaming ? colors.text.tertiary : accent}
      />
    </Pressable>
  );

  const renderAttachButton = () => (
    <Pressable
      style={({ pressed }) => [
        styles.toolBtn,
        {
          backgroundColor: pressed ? colors.surface.hover : colors.surface.input,
          opacity: disabled || att.attachments.length >= att.maxAttachments ? 0.54 : 1,
        },
      ]}
      onPress={openAttachmentSheet}
      disabled={disabled || att.attachments.length >= att.maxAttachments}
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

  const renderQueueSendButton = () => (
    <Pressable
      style={[styles.sendCircle, { backgroundColor: accent }]}
      onPress={handleSend}
      hitSlop={8}
      accessibilityLabel={cm.send}
    >
      <Icon source="arrow-up" size={20} color={colors.text.inverse} />
    </Pressable>
  );

  const renderStreamingRightActions = () => (
    <View style={styles.streamingActions}>
      {renderAttachButton()}
      {canQueueWhileBusy && isExpanded ? renderQueueSendButton() : null}
      {renderAbortButton()}
    </View>
  );

  const needsMultiline =
    isExpanded && (draft.includes('\n') || inputHeight > MIN_COMPOSER_INPUT_HEIGHT);
  const singleLineExpanded = isExpanded && !needsMultiline;

  const composerPlaceholder = streaming
    ? editingFollowUpId
      ? cm.inputPlaceholderSteeringEdit
      : cm.inputPlaceholderSteering
    : (placeholder ?? cm.inputPlaceholder);

  const renderSendOrStop = () => {
    if (streaming) return renderStreamingRightActions();
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

  return (
    <View style={[styles.wrap, { borderTopColor: 'transparent' }]}>
      {pendingFollowUps.length > 0 ? (
        <ChatPendingFollowUpStack
          items={pendingFollowUps}
          disabled={disabled}
          editingFollowUpId={editingFollowUpId}
          onEditInComposer={(id) => onBeginEditFollowUp?.(id)}
          onRemove={(id) => onPendingFollowUpRemove?.(id)}
          onMove={(id, dir) => onPendingFollowUpMove?.(id, dir)}
          onSteer={(id) => onPendingFollowUpSteer?.(id)}
          steeringBusyId={steeringFollowUpId}
        />
      ) : null}
      <VoiceRecordingOverlay
        visible={hudOpen || transcribing}
        zone={voiceZone}
        transcribing={transcribing}
        meterSamples={meterSamples}
        centerHint={cm.voiceReleaseCenterHint}
        textHint={cm.voiceReleaseTextHint}
        textGlyph={cm.voiceTextGlyph}
        cancelHint={cm.voiceReleaseCancelHint}
        transcribingLabel={cm.voiceTranscribing}
        isDark={isDark}
      />

      {palette.open ? (
        <CommandPaletteBar
          items={palette.items}
          query={palette.query}
          loading={palette.loading}
          onSelect={handlePaletteSelect}
        />
      ) : null}

      {att.attachments.length > 0 ? (
        <ComposerAttachmentStrip
          attachments={att.attachments}
          onRemove={att.removeAttachment}
          removeLabel={cm.removeAttachment}
        />
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
          Platform.OS === 'web' ? styles.shellRaisedWeb : styles.shellRaisedNative,
          { backgroundColor: surface, borderColor: shellBorder },
          shellRevealStyle,
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
              {!isExpanded ? (streaming ? renderStreamingRightActions() : renderAttachButton()) : null}
            </View>
            {isExpanded ? (
              <View style={styles.toolRow}>
                {renderVoiceToggle()}
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
        ) : isExpanded ? (
          <>
            <View
              style={[
                styles.holdPad,
                styles.holdPadExpanded,
                {
                  backgroundColor: colors.surface.input,
                  borderColor: colors.border.subtle,
                },
                hudOpen && { opacity: 0.92 },
              ]}
              {...panResponder.panHandlers}
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
                  {renderAttachButton()}
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
                  backgroundColor: colors.surface.input,
                  borderColor: colors.border.subtle,
                },
                hudOpen && { opacity: 0.92 },
              ]}
              {...panResponder.panHandlers}
            >
              <Text style={[styles.holdLabel, { color: colors.text.secondary }]}>
                {cm.holdToSpeak}
              </Text>
            </View>
            {streaming ? renderStreamingRightActions() : renderAttachButton()}
          </View>
        )}
      </Animated.View>

      <AttachmentSourceSheet
        visible={att.sheetOpen}
        items={sheetItems}
        onClose={att.closeSheet}
        onPick={(source) => void handleAttachmentPick(source)}
      />

      <AppToast visible={Boolean(snack)} onDismiss={() => setSnack('')} duration={TOAST_DURATION_LONG} bottomLift={TOAST_BOTTOM_LIFT_ABOVE_BAR}>
        {snack}
      </AppToast>
      <AppToast visible={Boolean(att.snack)} onDismiss={att.dismissSnack} duration={TOAST_DURATION_LONG} bottomLift={TOAST_BOTTOM_LIFT_ABOVE_BAR}>
        {att.snack}
      </AppToast>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xxl,
    overflow: 'hidden',
  },
  shellRaisedNative: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  shellRaisedWeb: {
    boxShadow: '0 4px 14px rgba(17, 19, 24, 0.10)',
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
    paddingVertical: Platform.select({ ios: 5, android: 4, web: 0, default: 4 }),
    maxHeight: MAX_COMPOSER_INPUT_HEIGHT,
    borderWidth: 0,
    ...(Platform.OS === 'android' ? { includeFontPadding: false as const } : null),
    ...Platform.select({
      web: { outlineStyle: 'none' } as Record<string, string>,
      default: {},
    }),
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
