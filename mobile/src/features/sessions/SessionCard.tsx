/**
 * Session list card — displays session info with long-press context menu.
 *
 * Shows session name (or truncated key), message count, relative time,
 * and status badge (pinned/archived). Long-press opens an action menu
 * for rename, pin/unpin, archive/unarchive, and delete.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { Icon, Menu, Text } from 'react-native-paper';

import { t, useMessages } from '../../i18n/messages';
import type { SessionListItem } from '../../query/sessions';

// ── Helpers ──────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(dateStr).toLocaleDateString();
}

function sessionDisplayName(item: SessionListItem): string {
  if (item.name?.trim()) return item.name.trim();
  // Show last 24 chars of key for unnamed sessions
  const key = item.key;
  return key.length > 24 ? `…${key.slice(-24)}` : key;
}

// ── Types ────────────────────────────────────────────────────────

export type SessionAction = 'open' | 'rename' | 'pin' | 'unpin' | 'archive' | 'unarchive' | 'delete';

type SessionCardProps = {
  session: SessionListItem;
  onPress: () => void;
  onAction: (action: SessionAction) => void;
};

// ── Component ────────────────────────────────────────────────────

export const SessionCard = memo(function SessionCard({
  session,
  onPress,
  onAction,
}: SessionCardProps) {
  const isDark = useColorScheme() === 'dark';
  const m = useMessages();
  const [menuVisible, setMenuVisible] = useState(false);

  const isPinned = session.status === 'pinned';
  const isArchived = session.status === 'archived';
  const title = useMemo(() => sessionDisplayName(session), [session]);
  const time = useMemo(() => relativeTime(session.updatedAt), [session.updatedAt]);

  const openMenu = useCallback(() => setMenuVisible(true), []);
  const closeMenu = useCallback(() => setMenuVisible(false), []);

  const handleAction = useCallback(
    (action: SessionAction) => {
      closeMenu();
      onAction(action);
    },
    [closeMenu, onAction],
  );

  return (
    <Menu
      visible={menuVisible}
      onDismiss={closeMenu}
      anchor={
        <Pressable
          onPress={onPress}
          onLongPress={openMenu}
          delayLongPress={350}
          android_ripple={{ color: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
              borderColor: isDark ? '#374151' : '#E5E7EB',
            },
            pressed && { opacity: 0.85 },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.content}>
              <View style={styles.titleRow}>
                {isPinned ? (
                  <Icon source="pin" size={14} color={isDark ? '#60A5FA' : '#2563EB'} />
                ) : null}
                {isArchived ? (
                  <Icon source="archive" size={14} color={isDark ? '#9CA3AF' : '#6B7280'} />
                ) : null}
                <Text
                  variant="titleSmall"
                  numberOfLines={1}
                  style={[styles.title, isArchived && styles.archivedTitle]}
                >
                  {title}
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Text variant="bodySmall" style={styles.meta}>
                  {t(m.sessions.messagesCount, { count: session.messageCount })}
                </Text>
                <Text variant="bodySmall" style={styles.metaDot}>
                  ·
                </Text>
                <Text variant="bodySmall" style={styles.meta}>
                  {time}
                </Text>
              </View>
            </View>
            <Icon source="chevron-right" size={20} color={isDark ? '#6B7280' : '#9CA3AF'} />
          </View>
        </Pressable>
      }
    >
      <Menu.Item
        leadingIcon="pencil-outline"
        title={m.sessionActions.rename}
        onPress={() => handleAction('rename')}
      />
      {isPinned ? (
        <Menu.Item
          leadingIcon="pin-off-outline"
          title={m.sessionActions.unpin}
          onPress={() => handleAction('unpin')}
        />
      ) : (
        <Menu.Item
          leadingIcon="pin-outline"
          title={m.sessionActions.pin}
          onPress={() => handleAction('pin')}
        />
      )}
      {isArchived ? (
        <Menu.Item
          leadingIcon="archive-arrow-up-outline"
          title={m.sessionActions.unarchive}
          onPress={() => handleAction('unarchive')}
        />
      ) : (
        <Menu.Item
          leadingIcon="archive-outline"
          title={m.sessionActions.archive}
          onPress={() => handleAction('archive')}
        />
      )}
      <Menu.Item
        leadingIcon="delete-outline"
        title={m.sessionActions.delete}
        titleStyle={styles.deleteText}
        onPress={() => handleAction('delete')}
      />
    </Menu>
  );
});

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    marginRight: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    flex: 1,
  },
  archivedTitle: {
    opacity: 0.6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  meta: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  metaDot: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  deleteText: {
    color: '#EF4444',
  },
});
