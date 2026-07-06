import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme';

export type ListSkeletonProps = {
  count?: number;
  withIcon?: boolean;
};

export const ListSkeleton = memo(function ListSkeleton({
  count = 8,
  withIcon = true,
}: ListSkeletonProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.wrap}>
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          style={[styles.row, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}
        >
          {withIcon ? <View style={[styles.icon, { backgroundColor: colors.surface.input }]} /> : null}
          <View style={styles.copy}>
            <View style={[styles.lineStrong, { backgroundColor: colors.surface.input }]} />
            <View style={[styles.line, { backgroundColor: colors.surface.input }]} />
            <View style={[styles.meta, { backgroundColor: colors.surface.input }]} />
          </View>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  row: {
    minHeight: 78,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 10,
  },
  copy: {
    flex: 1,
    gap: 8,
  },
  lineStrong: {
    width: '62%',
    height: 14,
    borderRadius: 7,
  },
  line: {
    width: '86%',
    height: 12,
    borderRadius: 6,
  },
  meta: {
    width: '34%',
    height: 10,
    borderRadius: 5,
  },
});
