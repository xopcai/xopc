import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { radii, spacing, typography, useTheme } from '../../theme';
import { useReadAloudStore } from '../voice/read-aloud-store';

export const ContinuousReadAloudBar = memo(function ContinuousReadAloudBar({
  sessionKey,
}: {
  sessionKey: string;
}) {
  const { colors } = useTheme();
  const { chat: m } = useMessages();
  const active = useReadAloudStore((state) => state.continuousSessionKey === sessionKey);
  const sourceSessionKey = useReadAloudStore((state) => state.source?.sessionKey);
  const disableContinuous = useReadAloudStore((state) => state.disableContinuous);
  const stop = useReadAloudStore((state) => state.stop);

  const handleStop = useCallback(() => {
    disableContinuous();
    if (sourceSessionKey === sessionKey) stop();
  }, [disableContinuous, sessionKey, sourceSessionKey, stop]);

  if (!active) return null;

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.accent.selectionBg,
          borderColor: colors.border.subtle,
        },
      ]}
    >
      <Icon source="volume-high" size={17} color={colors.accent.primary} />
      <Text numberOfLines={1} style={[styles.label, { color: colors.text.secondary }]}>
        {m.continuousReadAloudActive}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={m.continuousReadAloudStop}
        hitSlop={8}
        onPress={handleStop}
        style={styles.close}
      >
        <Icon source="close" size={17} color={colors.text.secondary} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    minHeight: 36,
    marginHorizontal: spacing.content,
    marginBottom: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.full,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    ...typography.caption,
    flex: 1,
  },
  close: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
