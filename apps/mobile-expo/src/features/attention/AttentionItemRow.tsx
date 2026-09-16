import { memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { motion, useReducedMotion } from '../../motion';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import type { HomeAction, HomeFocusItem } from '../../query/home';
import { radii, spacing, typography, useTheme } from '../../theme';

type RemoteAttentionAction = Exclude<HomeAction, { type: 'open' | 'review_judgment' }>;

export const AttentionItemRow = memo(function AttentionItemRow({
  item,
  pending,
  onAction,
}: {
  item: HomeFocusItem;
  pending: boolean;
  onAction: (action: HomeAction) => void;
}) {
  const { colors } = useTheme();
  const m = useMessages().mobileExperience;
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const reviewRequired = [item.primaryAction, ...item.secondaryActions].some(action => action?.type === 'connector_decision');
  const actions = [item.primaryAction, ...item.secondaryActions]
    .filter((action): action is RemoteAttentionAction => Boolean(
      action && action.type !== 'open' && action.type !== 'review_judgment',
    ));
  const icon = item.kind === 'failure' ? 'alert-circle-outline' : 'shield-check-outline';
  const signal = item.kind === 'failure' ? colors.semantic.error : colors.semantic.warning;

  return (
    <Animated.View layout={reducedMotion ? undefined : LinearTransition.duration(motion.duration.quick)} style={[styles.row, { borderBottomColor: colors.border.subtle }]}>
      <Pressable
        style={({ pressed }) => [styles.main, pressed && { backgroundColor: colors.surface.pressed }]}
        onPress={() => reviewRequired ? setExpanded(value => !value) : item.openAction && onAction(item.openAction)}
        disabled={!reviewRequired && !item.openAction}
        accessibilityRole={reviewRequired || item.openAction ? 'button' : undefined}
        accessibilityState={reviewRequired ? { expanded } : undefined}
      >
        <View style={[styles.icon, { backgroundColor: colors.surface.grouped }]}>
          <Icon source={icon} size={19} color={signal} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text.primary }]} numberOfLines={expanded ? undefined : 2}>{item.title}</Text>
          <Text style={[styles.summary, { color: colors.text.secondary }]} numberOfLines={expanded ? undefined : 2}>{item.summary}</Text>
          {expanded && item.reviewDetail && item.reviewDetail !== item.summary ? <Text style={[styles.summary, { color: colors.text.primary }]}>{item.reviewDetail}</Text> : null}
          {item.recommendation && item.recommendation !== item.summary ? (
            <Text style={[styles.recommendation, { color: colors.text.tertiary }]} numberOfLines={expanded ? undefined : 2}>
              {item.recommendation}
            </Text>
          ) : null}
        </View>
        {item.openAction ? <Icon source="chevron-right" size={18} color={colors.text.tertiary} /> : null}
      </Pressable>
      {reviewRequired && !expanded ? <Pressable accessibilityRole="button" onPress={() => setExpanded(true)} style={styles.action}><Text style={{ color: colors.accent.primary }}>{m.review}</Text></Pressable> : null}
      {actions.length && (!reviewRequired || expanded) ? (
        <View style={styles.actions}>
          {actions.map((action, index) => (
            <Pressable
              key={`${action.type}:${action.label}`}
              style={({ pressed }) => [
                styles.action,
                {
                  backgroundColor: index === 0 ? colors.accent.primary : colors.surface.grouped,
                  opacity: pressed ? 0.76 : 1,
                },
              ]}
              onPress={() => onAction(action)}
              disabled={pending}
              accessibilityRole="button"
              accessibilityState={{ disabled: pending, busy: pending }}
            >
              {pending && index === 0 ? <Icon source="clock-outline" size={14} color={colors.accent.onPrimary} /> : null}
              <Text style={[
                styles.actionText,
                { color: index === 0 ? colors.accent.onPrimary : colors.text.secondary },
              ]}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.xs },
  main: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  icon: { width: 36, height: 36, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { ...typography.ui, fontWeight: '600' },
  summary: { ...typography.label, marginTop: spacing.xxs },
  recommendation: { ...typography.caption, marginTop: spacing.xs },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  action: { minHeight: 44, minWidth: 72, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
  actionText: { ...typography.label, fontWeight: '600' },
});
