import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { ListSelectionCheckbox } from '../../components/ListSelectionCheckbox';
import { SwipeableRow, type SwipeAction } from '../../components/SwipeableRow';
import { LIST_DELAY_LONG_PRESS } from '../../constants/list-interaction';
import { useMessages } from '../../i18n/messages';
import type { NoteIndexEntry, NoteStatus } from '../../query/notes';
import { radii, spacing, typography, useTheme } from '../../theme';

import { noteKindLabel } from './note-list-display';
import { resolveNoteListPreview } from './note-title';

function statusLabel(
  status: NoteStatus,
  labels: Record<'filterInbox' | 'filterProcessed' | 'filterArchived', string>,
): string | null {
  switch (status) {
    case 'inbox':
      return labels.filterInbox;
    case 'processed':
      return null;
    case 'archived':
      return labels.filterArchived;
    default:
      return null;
  }
}

export type NoteCardProps = {
  note: NoteIndexEntry;
  onPress: (note: NoteIndexEntry) => void;
  onLongPress?: (note: NoteIndexEntry) => void;
  onSwipeAction?: (note: NoteIndexEntry, action: SwipeAction) => void;
  selectionMode?: boolean;
  selected?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
};

export function NoteCard({
  note,
  onPress,
  onLongPress,
  onSwipeAction,
  selectionMode = false,
  selected = false,
  isFirst = false,
  isLast = false,
}: NoteCardProps) {
  const { colors } = useTheme();
  const m = useMessages();
  const pm = m.notesPage;

  const preview = useMemo(
    () => resolveNoteListPreview(note, { untitled: pm.untitledNote }),
    [note, pm.untitledNote],
  );

  const displayTitle = useMemo(() => {
    if (preview.title !== pm.untitledNote) return preview.title;
    return noteKindLabel(note.kind, pm);
  }, [note.kind, pm, preview.title]);

  const kindLabel = noteKindLabel(note.kind, pm);
  const statusText = statusLabel(note.status, pm);
  const taskStateText = note.taskDone ? pm.done : pm.kindTodo;
  const visibleTags = note.tags?.slice(0, 2) ?? [];
  const updatedAt = note.updatedAt ?? note.createdAt;
  const time = new Date(updatedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const metaParts = [
    kindLabel,
    statusText,
    note.kind === 'task' && note.taskDone != null ? taskStateText : null,
    ...visibleTags,
    time,
  ].filter((part): part is string => Boolean(part));

  const handlePress = useCallback(() => onPress(note), [note, onPress]);
  const handleLongPress = useCallback(() => onLongPress?.(note), [note, onLongPress]);
  const handleSwipeAction = useCallback((action: SwipeAction) => {
    onSwipeAction?.(note, action);
  }, [note, onSwipeAction]);

  const swipeActions = useMemo<SwipeAction[]>(() => [
    note.pinned
      ? { key: 'unpin', icon: 'pin-off-outline', color: 'green', label: pm.unpin }
      : { key: 'pin', icon: 'pin-outline', color: 'green', label: pm.pin },
    { key: 'archive', icon: 'archive-arrow-down-outline', color: 'blue', label: pm.archive },
    { key: 'delete', icon: 'trash-can-outline', color: 'red', label: pm.delete, destructive: true },
  ], [note.pinned, pm.archive, pm.delete, pm.pin, pm.unpin]);

  const cardContent = (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: selected
            ? colors.accent.selectionBg
            : pressed
              ? colors.surface.pressed
              : colors.surface.panel,
          borderColor: selected ? colors.accent.primary : colors.border.subtle,
          borderTopWidth: isFirst || selected ? StyleSheet.hairlineWidth : 0,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderTopLeftRadius: isFirst || selected ? radii.lg : 0,
          borderTopRightRadius: isFirst || selected ? radii.lg : 0,
          borderBottomLeftRadius: isLast || selected ? radii.lg : 0,
          borderBottomRightRadius: isLast || selected ? radii.lg : 0,
        },
        selected && styles.selectedCard,
      ]}
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={LIST_DELAY_LONG_PRESS}
      accessibilityState={selectionMode ? { selected } : undefined}
    >
      <View style={styles.topRow}>
        {selectionMode ? (
          <ListSelectionCheckbox selected={selected} size={28} />
        ) : null}
        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text
              style={[styles.title, { color: colors.text.primary }]}
              numberOfLines={1}
            >
              {displayTitle}
            </Text>
            {note.pinned ? <Icon source="pin" size={13} color={colors.accent.primary} /> : null}
          </View>
          {!!preview.subtitle && (
            <Text
              style={[styles.subtitle, { color: colors.text.secondary }]}
              numberOfLines={1}
            >
              {preview.subtitle}
            </Text>
          )}
          <Text style={[styles.metaText, { color: colors.text.tertiary }]} numberOfLines={1}>
            {metaParts.join(' · ')}
          </Text>
        </View>
      </View>
    </Pressable>
  );

  if (!selectionMode && onSwipeAction) {
    return (
      <SwipeableRow actions={swipeActions} onActionPress={handleSwipeAction} enabled={!selectionMode}>
        {cardContent}
      </SwipeableRow>
    );
  }

  return cardContent;
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.content,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 76,
    overflow: 'hidden',
  },
  selectedCard: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  copy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  metaText: {
    ...typography.caption,
  },
});
