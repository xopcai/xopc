import { useState } from 'react';
import { KeyboardController, useKeyboardHandler } from 'react-native-keyboard-controller';
import { scheduleOnRN } from 'react-native-worklets';

/** Reserve the keyboard destination without re-rendering the message list on every frame. */
export function useKeyboardListPadding(): number {
  const [padding, setPadding] = useState(() => KeyboardController.state().height);

  useKeyboardHandler({
    onStart: event => {
      'worklet';
      // Reserve room before opening; retain it throughout an interactive dismissal.
      if (event.height > 0) scheduleOnRN(setPadding, event.height);
    },
    onEnd: event => {
      'worklet';
      scheduleOnRN(setPadding, event.height);
    },
  }, []);

  return padding;
}
