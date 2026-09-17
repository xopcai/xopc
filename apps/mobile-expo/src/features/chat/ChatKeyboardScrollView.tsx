import { forwardRef, useCallback, type ComponentRef } from 'react';
import type { ScrollViewProps } from 'react-native';
import { KeyboardChatScrollView, useKeyboardHandler } from 'react-native-keyboard-controller';
import Animated, { scrollTo, useAnimatedReaction, useAnimatedRef, useScrollOffset, useSharedValue } from 'react-native-reanimated';

/** Keep the live edge anchored while the keyboard and navigation change the viewport. */
export const ChatKeyboardScrollView = forwardRef<ComponentRef<typeof KeyboardChatScrollView>, ScrollViewProps>(
  function ChatKeyboardScrollView({ onLayout, onContentSizeChange, onScrollBeginDrag, ...props }, ref) {
    const scrollRef = useAnimatedRef<Animated.ScrollView>();
    const offset = useScrollOffset(scrollRef);
    const viewport = useSharedValue(0);
    const content = useSharedValue(0);
    const inset = useSharedValue(0);
    const following = useSharedValue(false);
    const transitioning = useSharedValue(false);
    const attachRef = useCallback((node: ComponentRef<typeof KeyboardChatScrollView> | null) => {
      scrollRef(node);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }, [ref, scrollRef]);

    useKeyboardHandler({
      onStart: () => {
        'worklet';
        if (!transitioning.value) {
          following.value = offset.value + viewport.value >= content.value + inset.value - 20;
        }
        transitioning.value = true;
      },
      onMove: (event) => {
        'worklet';
        inset.value = event.height;
      },
      onInteractive: (event) => {
        'worklet';
        inset.value = event.height;
      },
      onEnd: (event) => {
        'worklet';
        inset.value = event.height;
        transitioning.value = false;
      },
    }, []);

    useAnimatedReaction(
      () => ({ height: inset.value, viewport: viewport.value }),
      ({ height, viewport: layoutHeight }) => {
        if (following.value && layoutHeight > 0) {
          scrollTo(scrollRef, 0, Math.max(0, content.value + height - layoutHeight), false);
        }
      },
    );

    return <KeyboardChatScrollView {...props} ref={attachRef}
      keyboardLiftBehavior="never"
      onLayout={(event) => {
        viewport.value = event.nativeEvent.layout.height;
        onLayout?.(event);
      }}
      onContentSizeChange={(width, height) => {
        content.value = height;
        onContentSizeChange?.(width, height);
      }}
      onScrollBeginDrag={(event) => {
        following.value = false;
        onScrollBeginDrag?.(event);
      }}
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustKeyboardInsets={false}
      contentInsetAdjustmentBehavior="never"
      removeClippedSubviews={false}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    />;
  },
);
