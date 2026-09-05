import { memo, type MutableRefObject } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Icon } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { radii, useTheme } from '../../theme';
import { useVoiceCaptureInteraction, type VoiceCapturePayload } from '../notes/use-voice-capture-interaction';

export const NoteVoiceControl = memo(function NoteVoiceControl({
  markdownRef,
  disabled,
  onChangeMarkdown,
  onVoiceCapture,
}: {
  markdownRef: MutableRefObject<string>;
  disabled: boolean;
  onChangeMarkdown: (markdown: string) => void;
  onVoiceCapture: (payload: VoiceCapturePayload) => void;
}) {
  const { colors } = useTheme();
  const label = useMessages().notesPage.editorInsertAudio;
  const voice = useVoiceCaptureInteraction({
    value: markdownRef.current,
    onChangeText: onChangeMarkdown,
    onVoiceCapture,
    disabled,
    enabled: !disabled,
  });

  return <>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: voice.active }}
      disabled={disabled}
      onPress={voice.onPress}
      {...voice.panHandlers}
      style={({ pressed }) => [styles.button, {
        backgroundColor: voice.active ? colors.accent.primary : colors.surface.panel,
        borderColor: voice.active ? colors.accent.primary : colors.border.default,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      }]}
    >
      <Icon source={voice.active ? 'stop' : 'microphone-outline'} size={21} color={voice.active ? colors.accent.onPrimary : colors.text.secondary} />
    </Pressable>
    {voice.feedback}
  </>;
});

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 16,
    bottom: 18,
    zIndex: 30,
    width: 46,
    height: 46,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
