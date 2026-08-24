/**
 * Session list card — tap to open; long-press for multi-select;
 * swipe left for quick actions (archive / delete).
 */
import { memo, useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { ListSelectionCheckbox } from '../../components/ListSelectionCheckbox';
import { SwipeableRow, type SwipeAction } from '../../components/SwipeableRow';
import { LIST_DELAY_LONG_PRESS } from '../../constants/list-interaction';
import { t, useMessages } from '../../i18n/messages';
import { sessionDisplayName } from '../../lib/session-helpers';
import type { SessionListItem } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';
import { AgentAvatar } from '../ai/AgentAvatar';

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr);
  const then = date.getTime();
  if (!Number.isFinite(then)) return '';

  const diff = now - then;
  const mins = Math.floor(diff / 60_000);
  const intl = typeof Intl === 'object' ? Intl : undefined;
  const RelativeTimeFormat = intl?.RelativeTimeFormat;
  if (typeof RelativeTimeFormat === 'function') {
    const formatter = new RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
    if (mins < 1) return formatter.format(0, 'second');
    if (mins < 60) return formatter.format(-mins, 'minute');
    const hours = Math.floor(mins / 60);
    if (hours < 24) return formatter.format(-hours, 'hour');
    const days = Math.floor(hours / 24);
    if (days < 7) return formatter.format(-days, 'day');
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return formatter.format(-weeks, 'week');
  }

  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const DateTimeFormat = intl?.DateTimeFormat;
  if (typeof DateTimeFormat === 'function') {
    return new DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function resolveSessionAgentId(session: SessionListItem): string {
  const routedAgentId = session.routing?.agentId?.trim().toLowerCase();
  if (routedAgentId) return routedAgentId;

  const parts = session.key.trim().toLowerCase().split(':').filter(Boolean);
  if (parts[0] === 'agent' && parts[1]) return parts[1];
  return 'main';
}

function resolveSessionAgentAvatar(session: SessionListItem): string | undefined {
  const maybeSessionWithAvatar = session as SessionListItem & {
    avatar?: unknown;
    agentAvatar?: unknown;
    routing?: SessionListItem['routing'] & {
      avatar?: unknown;
      agentAvatar?: unknown;
    };
  };
  const value = maybeSessionWithAvatar.routing?.agentAvatar
    ?? maybeSessionWithAvatar.routing?.avatar
    ?? maybeSessionWithAvatar.agentAvatar
    ?? maybeSessionWithAvatar.avatar;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

type SessionCardProps = {
  session: SessionListItem;
  onPress: () => void;
  onPressIn?: () => void;
  onLongPress?: () => void;
  onSwipeAction?: (action: SwipeAction) => void;
  selectionMode?: boolean;
  selected?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
};

export const SessionCard = memo(function SessionCard({
  session,
  onPress,
  onPressIn,
  onLongPress,
  onSwipeAction,
  selectionMode = false,
  selected = false,
  isFirst = false,
  isLast = false,
}: SessionCardProps) {
  const { colors } = useTheme();
  const m = useMessages();
  const sa = m.sessionActions;

  const isPinned = session.status === 'pinned';
  const isArchived = session.status === 'archived';
  const title = useMemo(() => sessionDisplayName(session, m.sessions.untitled), [m.sessions.untitled, session]);
  const time = useMemo(() => relativeTime(session.updatedAt), [session.updatedAt]);
  const agentId = useMemo(() => resolveSessionAgentId(session), [session]);
  const agentAvatar = useMemo(() => resolveSessionAgentAvatar(session), [session]);

  const handlePress = useCallback(() => onPress(), [onPress]);

  const handleLongPress = useCallback(() => {
    onLongPress?.();
  }, [onLongPress]);

  const swipeActions: SwipeAction[] = useMemo(() => [
    isArchived
      ? { key: 'archive', icon: 'archive-arrow-up-outline', color: 'blue', label: sa.unarchive }
      : { key: 'archive', icon: 'archive-arrow-down-outline', color: 'blue', label: sa.archive },
    { key: 'delete', icon: 'trash-can-outline', color: 'red', label: sa.delete, destructive: true },
  ], [isArchived, sa.archive, sa.delete, sa.unarchive]);

  const handleSwipeAction = useCallback((action: SwipeAction) => {
    onSwipeAction?.(action);
  }, [onSwipeAction]);

  const cardContent = (
    <Pressable
      onPress={handlePress}
      onPressIn={onPressIn}
      onLongPress={handleLongPress}
      delayLongPress={LIST_DELAY_LONG_PRESS}
      android_ripple={{ color: colors.surface.hover }}
      accessibilityState={selectionMode ? { selected } : undefined}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: selected ? colors.accent.selectionBg : colors.surface.panel,
          borderColor: selected ? colors.accent.primary : colors.border.subtle,
          borderTopWidth: isFirst || selected ? StyleSheet.hairlineWidth : 0,
          borderBottomWidth: isLast || selected ? StyleSheet.hairlineWidth : StyleSheet.hairlineWidth,
          borderTopLeftRadius: isFirst || selected ? radii.lg : 0,
          borderTopRightRadius: isFirst || selected ? radii.lg : 0,
          borderBottomLeftRadius: isLast || selected ? radii.lg : 0,
          borderBottomRightRadius: isLast || selected ? radii.lg : 0,
        },
        selected && styles.selectedCard,
        pressed && !selected && { backgroundColor: colors.surface.pressed },
      ]}
    >
      <View style={styles.row}>
        {selectionMode ? (
          <ListSelectionCheckbox selected={selected} size={28} />
        ) : null}
        <View style={styles.avatar}>
          <AgentAvatar agentId={agentId} avatar={agentAvatar} size={40} />
        </View>
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text
              variant="titleSmall"
              numberOfLines={1}
              style={[styles.title, isArchived && styles.archivedTitle]}
            >
              {title}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={[styles.meta, { color: colors.text.tertiary }]} numberOfLines={1}>
              {t(m.sessions.messagesCount, { count: session.messageCount })}
            </Text>
            {isPinned ? <Icon source="pin" size={12} color={colors.accent.primary} /> : null}
            {isArchived ? <Icon source="archive-outline" size={12} color={colors.text.tertiary} /> : null}
          </View>
        </View>
        <View style={styles.trailing}>
          <Text style={[styles.time, { color: colors.text.tertiary }]}>
            {time}
          </Text>
          <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
        </View>
      </View>
    </Pressable>
  );

  // Wrap with SwipeableRow only when not in selection mode
  if (!selectionMode && onSwipeAction) {
    return (
      <SwipeableRow
        actions={swipeActions}
        onActionPress={handleSwipeAction}
        enabled={!selectionMode}
      >
        {cardContent}
      </SwipeableRow>
    );
  }

  return cardContent;
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.content,
    minHeight: 72,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    overflow: 'hidden',
  },
  selectedCard: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    flex: 1,
    ...typography.body,
    fontWeight: '600',
  },
  archivedTitle: {
    opacity: 0.6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  meta: {
    ...typography.caption,
    flexShrink: 1,
  },
  trailing: {
    minWidth: 62,
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  time: {
    ...typography.caption,
    textAlign: 'right',
  },
});
