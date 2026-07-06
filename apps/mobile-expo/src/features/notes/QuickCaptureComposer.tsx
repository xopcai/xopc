import { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { radii, spacing, typography, useTheme } from '../../theme';
import type { AttachmentPickSource } from '../chat/attachment-file-io';
import { AttachmentSourceSheet } from '../chat/attachment-source-sheet';
import { MIN_COMPOSER_INPUT_HEIGHT } from '../chat/composer-layout';
import { useVoiceCaptureInteraction } from './use-voice-capture-interaction';

type InputMode = 'text' | 'voice';

export interface QuickCaptureComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onVoiceCapture: (payload: { uri: string; durationMillis: number; mimeType: string }) => void;
  onAttachmentSource: (source: AttachmentPickSource) => void;
  placeholder: string;
  disabled?: boolean;
  submitting?: boolean;
}

export function QuickCaptureComposer({
  value,
  onChangeText,
  onSubmit,
  onVoiceCapture,
  onAttachmentSource,
  placeholder,
  disabled = false,
  submitting = false,
}: QuickCaptureComposerProps) {
  const { colors } = useTheme();
  const { chat: cm } = useMessages();
  const [mode, setMode] = useState<InputMode>('text');
  const [sheetOpen, setSheetOpen] = useState(false);

  const accent = colors.accent.primary;
  const surface = colors.surface.panel;
  const border = colors.border.default;
  const canSubmit = value.trim().length > 0 && !disabled && !submitting;

  const canCaptureVoice = mode === 'voice' && !disabled && !submitting;
  const voice = useVoiceCaptureInteraction({
    value,
    onChangeText,
    onVoiceCapture,
    disabled,
    submitting,
    enabled: canCaptureVoice,
    onSettled: () => setMode('text'),
  });

  const toggleMode = useCallback(() => {
    if (disabled || submitting || voice.active || voice.transcribing) return;
    setMode((prev) => (prev === 'text' ? 'voice' : 'text'));
  }, [disabled, submitting, voice.active, voice.transcribing]);

  const sheetItems = useMemo(
    () => [
      { source: 'camera' as const, icon: 'camera-outline', label: cm.takePhoto },
      { source: 'photos' as const, icon: 'image-outline', label: cm.photos },
      { source: 'document' as const, icon: 'folder-outline', label: cm.localFiles },
    ],
    [cm.localFiles, cm.photos, cm.takePhoto],
  );

  const renderVoiceToggle = () => (
    <Pressable
      style={({ pressed }) => [
        styles.toolBtn,
        {
          backgroundColor: pressed ? colors.surface.hover : colors.surface.input,
          opacity: disabled || submitting ? 0.54 : 1,
        },
      ]}
      onPress={toggleMode}
      disabled={disabled || submitting}
      accessibilityLabel={mode === 'text' ? 'Switch to voice input' : 'Switch to keyboard'}
    >
      <Icon
        source={mode === 'text' ? 'microphone-outline' : 'keyboard-outline'}
        size={22}
        color={disabled || submitting ? colors.text.tertiary : accent}
      />
    </Pressable>
  );

  const renderAttachButton = () => (
    <Pressable
      style={({ pressed }) => [
        styles.toolBtn,
        {
          backgroundColor: pressed ? colors.surface.hover : colors.surface.input,
          opacity: disabled || submitting ? 0.54 : 1,
        },
      ]}
      onPress={() => setSheetOpen(true)}
      disabled={disabled || submitting}
      accessibilityLabel={cm.attachFile}
    >
      <Icon
        source="plus-circle-outline"
        size={24}
        color={disabled || submitting ? colors.text.tertiary : accent}
      />
    </Pressable>
  );

  const renderSendButton = () => (
    <Pressable
      style={[styles.sendCircle, { backgroundColor: canSubmit ? colors.text.primary : colors.surface.active }]}
      onPress={onSubmit}
      disabled={!canSubmit}
      hitSlop={8}
      accessibilityLabel={cm.send}
    >
      <Icon source="arrow-up" size={20} color={colors.text.inverse} />
    </Pressable>
  );

  const renderRightAction = () => (canSubmit ? renderSendButton() : renderAttachButton());

  return (
    <>
      {voice.feedback}

      <View
        style={[
          styles.shell,
          Platform.OS === 'web' ? styles.shellRaisedWeb : styles.shellRaisedNative,
          { backgroundColor: surface, borderColor: border },
        ]}
      >
        {mode === 'text' ? (
          <View style={styles.compactRow}>
            {renderVoiceToggle()}
            <View style={styles.compactInputWrap}>
              <TextInput
                style={[styles.input, { color: colors.text.primary }]}
                placeholder={placeholder}
                placeholderTextColor={colors.text.tertiary}
                value={value}
                onChangeText={onChangeText}
                onSubmitEditing={onSubmit}
                returnKeyType="send"
                multiline
                blurOnSubmit
                editable={!disabled && !submitting}
                textAlignVertical="center"
              />
            </View>
            {renderRightAction()}
          </View>
        ) : (
          <View style={styles.compactRow}>
            {renderVoiceToggle()}
            <View
              style={[
                styles.holdPad,
                {
                  backgroundColor: colors.surface.input,
                  borderColor: colors.border.subtle,
                },
                voice.active && { opacity: 0.92 },
              ]}
              {...voice.panHandlers}
            >
              <Text style={[styles.holdLabel, { color: colors.text.secondary }]}>
                {cm.holdToSpeak}
              </Text>
            </View>
            {renderAttachButton()}
          </View>
        )}
      </View>

      <AttachmentSourceSheet
        visible={sheetOpen}
        items={sheetItems}
        onClose={() => setSheetOpen(false)}
        onPick={(source) => {
          setSheetOpen(false);
          setMode('text');
          onAttachmentSource(source);
        }}
      />

    </>
  );
}

const styles = StyleSheet.create({
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
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  compactInputWrap: {
    flex: 1,
    justifyContent: 'center',
    minHeight: MIN_COMPOSER_INPUT_HEIGHT,
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
  input: {
    ...typography.body,
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    paddingHorizontal: 4,
    paddingVertical: Platform.select({ ios: 5, android: 4, default: 4 }),
    maxHeight: 100,
    borderWidth: 0,
    ...(Platform.OS === 'android' ? { includeFontPadding: false as const } : null),
  },
  holdPad: {
    flex: 1,
    minHeight: MIN_COMPOSER_INPUT_HEIGHT,
    marginVertical: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  holdLabel: {
    ...typography.body,
    fontWeight: '600',
  },
});
