import { useState } from 'react';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useAnimatedReaction } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/** Bottom inset for scrollable chat content while the IME is visible. */
export function useKeyboardListPadding(): number {
  const { height } = useReanimatedKeyboardAnimation();
  const [padding, setPadding] = useState(0);

  useAnimatedReaction(
    () => Math.abs(height.value),
    (next, prev) => {
      if (next !== prev) {
        scheduleOnRN(setPadding, next);
      }
    },
    [height],
  );

  return padding;
}
