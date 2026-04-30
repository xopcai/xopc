/**
 * Chat input composer — multiline auto-sizing text input with send/abort toggle.
 */
import { memo, useCallback, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { IconButton } from 'react-native-paper';

const MAX_INPUT_HEIGHT = 120;
const MIN_INPUT_HEIGHT = 42;

export const ChatComposer = memo(function ChatComposer({
  disabled,
  streaming,
  onSend,
  onAbort,
}: {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
}) {
  const isDark = useColorScheme() === 'dark';
  const [draft, setDraft] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  const inputRef = useRef<TextInput>(null);

  const canSend = draft.trim().length > 0 && !streaming && !disabled;

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
    setInputHeight(MIN_INPUT_HEIGHT);
    // Keep keyboard open after send for quick follow-up
  }, [draft, onSend]);

  const handleAbort = useCallback(() => {
    onAbort();
  }, [onAbort]);

  const onContentSizeChange = useCallback(
    (e: { nativeEvent: { contentSize: { height: number } } }) => {
      const h = Math.min(Math.max(e.nativeEvent.contentSize.height, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT);
      setInputHeight(h);
    },
    [],
  );

  const handleSubmitEditing = useCallback(() => {
    if (canSend) handleSend();
  }, [canSend, handleSend]);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
          borderTopColor: isDark ? '#374151' : '#E5E7EB',
        },
      ]}
    >
      <View
        style={[
          styles.inputWrapper,
          {
            backgroundColor: isDark ? '#111827' : '#F3F4F6',
            borderColor: isDark ? '#374151' : '#D1D5DB',
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            {
              height: inputHeight,
              color: isDark ? '#F3F4F6' : '#1F2937',
            },
          ]}
          placeholder="Message"
          placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
          value={draft}
          onChangeText={setDraft}
          multiline
          editable={!disabled}
          onContentSizeChange={onContentSizeChange}
          onSubmitEditing={handleSubmitEditing}
          blurOnSubmit={false}
          returnKeyType={Platform.OS === 'ios' ? 'default' : 'send'}
          textAlignVertical="center"
          autoCapitalize="sentences"
        />
      </View>

      {streaming ? (
        <IconButton
          icon="stop-circle"
          mode="contained-tonal"
          size={22}
          onPress={handleAbort}
          style={styles.actionButton}
          accessibilityLabel="Stop streaming"
        />
      ) : (
        <IconButton
          icon="send"
          mode="contained"
          size={22}
          onPress={handleSend}
          disabled={!canSend}
          style={styles.actionButton}
          accessibilityLabel="Send message"
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  inputWrapper: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    overflow: 'hidden',
  },
  input: {
    fontSize: 15,
    lineHeight: 20,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    maxHeight: MAX_INPUT_HEIGHT,
    borderRadius: 20,
    borderWidth: 0,
    // Prevent platform-specific focus outline from showing a rectangular border
    ...Platform.select({
      web: { outlineStyle: 'none' } as Record<string, string>,
      default: {},
    }),
  },
  actionButton: {
    marginBottom: 2,
  },
});
