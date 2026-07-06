/**
 * Lightweight skeleton for the session list. Shown only when there's no
 * cached placeholder data (true first-time use). Returning users see the
 * persisted MMKV-backed list instantly, so this rarely renders in practice.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '../../theme';

export type SessionListSkeletonProps = {
  rows?: number;
  isDark?: boolean;
};

export const SessionListSkeleton = memo(function SessionListSkeleton({
  rows = 5,
  isDark = false,
}: SessionListSkeletonProps) {
  const themeColors = isDark ? colors.dark : colors.light;
  const lineColor = themeColors.surface.input;
  const subColor = themeColors.border.subtle;
  return (
    <View style={styles.wrap}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.row}>
          <View style={[styles.title, { backgroundColor: lineColor, width: rowWidth(i) }]} />
          <View style={[styles.sub, { backgroundColor: subColor }]} />
        </View>
      ))}
    </View>
  );
});

function rowWidth(i: number): `${number}%` {
  // Vary widths so rows don't all look identical.
  const widths: `${number}%`[] = ['82%', '74%', '90%', '68%', '78%'];
  return widths[i % widths.length];
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  row: {
    paddingVertical: 10,
    gap: 6,
  },
  title: {
    height: 14,
    borderRadius: 6,
  },
  sub: {
    height: 10,
    borderRadius: 5,
    width: '40%',
  },
});
