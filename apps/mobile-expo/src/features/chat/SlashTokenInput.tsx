/**
 * TextInput with whole-token backspace for `/skill:name` tokens.
 *
 * Styled pill rendering inside TextInput is intentionally disabled: toggling
 * between controlled `value` and nested Text children crashes on iOS/Android.
 */
import { forwardRef, memo, useCallback, useImperativeHandle, useRef } from 'react';
import {
  TextInput,
  type TextInputProps,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputSelectionChangeEventData,
} from 'react-native';

import { findPillTokenEndingAtCursor } from './slash-token-utils';

export type { SlashTokenSegment } from './slash-token-utils';
export { findPillTokenEndingAtCursor, parseSlashTokens } from './slash-token-utils';

interface SlashTokenInputProps extends Omit<TextInputProps, 'children'> {
  value: string;
  onChangeText: (text: string) => void;
  onCursorChange?: (pos: number) => void;
  cursorPos: number;
}

export const SlashTokenInput = memo(
  forwardRef<TextInput, SlashTokenInputProps>(function SlashTokenInput(
    {
      value,
      onChangeText,
      onCursorChange,
      cursorPos,
      style,
      ...rest
    },
    ref,
  ) {
    const inputRef = useRef<TextInput>(null);
    useImperativeHandle(ref, () => inputRef.current!, []);
    const suppressNextChangeRef = useRef(false);

    const handleKeyPress = useCallback(
      (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        if (e.nativeEvent.key === 'Backspace') {
          const tokenRange = findPillTokenEndingAtCursor(value, cursorPos);
          if (tokenRange) {
            const newText =
              value.slice(0, tokenRange.start) + value.slice(tokenRange.end);
            suppressNextChangeRef.current = true;
            onChangeText(newText);
            onCursorChange?.(tokenRange.start);
          }
        }
      },
      [value, cursorPos, onChangeText, onCursorChange],
    );

    const handleChangeText = useCallback(
      (text: string) => {
        if (suppressNextChangeRef.current) {
          suppressNextChangeRef.current = false;
          return;
        }
        onChangeText(text);
      },
      [onChangeText],
    );

    const handleSelectionChange = useCallback(
      (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        onCursorChange?.(e.nativeEvent.selection.end);
      },
      [onCursorChange],
    );

    return (
      <TextInput
        ref={inputRef}
        style={style}
        value={value}
        onChangeText={handleChangeText}
        onSelectionChange={handleSelectionChange}
        onKeyPress={handleKeyPress}
        {...rest}
      />
    );
  }),
);
