import { useCallback, useMemo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
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
};

export function NoteCard({
  note,
  onPress,
  onLongPress,
  onSwipeAction,
  selectionMode = false,
  selected = false,
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
  const hiddenTagCount = Math.max(0, (note.tags?.length ?? 0) - visibleTags.length);
  const updatedAt = note.updatedAt ?? note.createdAt;
  const time = new Date(updatedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

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
        !selected && (Platform.OS === 'web' ? styles.cardRaisedWeb : styles.cardRaisedNative),
        {
          backgroundColor: selected
            ? colors.accent.selectionBg
            : pressed
              ? colors.surface.hover
              : colors.surface.panel,
          borderColor: selected ? colors.accent.primary : colors.border.default,
        },
        pressed && !selected && (Platform.OS === 'web' ? styles.cardPressedWeb : styles.cardPressedNative),
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
          <Text
            style={[styles.title, { color: colors.text.primary }]}
            numberOfLines={1}
          >
            {displayTitle}
          </Text>
          {!!preview.subtitle && (
            <Text
              style={[styles.subtitle, { color: colors.text.secondary }]}
              numberOfLines={1}
            >
              {preview.subtitle}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.metaRow}>
        {!!kindLabel && (
          <View
            style={[
              styles.chip,
              {
                backgroundColor: colors.surface.input,
                borderColor: colors.border.subtle,
              },
            ]}
          >
            <Text style={[styles.chipText, { color: colors.text.secondary }]}>{kindLabel}</Text>
          </View>
        )}
        {!!statusText && (
          <View
            style={[
              styles.chip,
              {
                backgroundColor: colors.surface.input,
                borderColor: colors.border.subtle,
              },
            ]}
          >
            <View style={[styles.statusDot, { backgroundColor: colors.semantic.warning }]} />
            <Text style={[styles.chipText, { color: colors.text.secondary }]}>{statusText}</Text>
          </View>
        )}
        {note.kind === 'task' && note.taskDone != null && (
          <View
            style={[
              styles.chip,
              {
                backgroundColor: colors.surface.input,
                borderColor: colors.border.subtle,
              },
            ]}
          >
            <Icon
              source={note.taskDone ? 'check-circle-outline' : 'circle-outline'}
              size={12}
              color={note.taskDone ? colors.semantic.success : colors.text.tertiary}
            />
            <Text style={[styles.chipText, { color: colors.text.secondary }]}>
              {taskStateText}
            </Text>
          </View>
        )}
        {note.pinned && (
          <View
            style={[
              styles.chip,
              styles.pinChip,
              {
                backgroundColor: colors.accent.soft,
                borderColor: colors.accent.selectionBg,
              },
            ]}
          >
            <Icon source="pin" size={11} color={colors.accent.primary} />
          </View>
        )}
        {visibleTags.map((tag) => (
          <View
            key={tag}
            style={[
              styles.chip,
              {
                backgroundColor: colors.surface.input,
                borderColor: colors.border.subtle,
              },
            ]}
          >
            <Text style={[styles.chipText, { color: colors.text.secondary }]}>{tag}</Text>
          </View>
        ))}
        {hiddenTagCount > 0 ? (
          <Text style={[styles.time, { color: colors.text.tertiary }]}>+{hiddenTagCount}</Text>
        ) : null}
        <Text style={[styles.time, { color: colors.text.tertiary }]}>{time}</Text>
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
    width: '100%',
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 84,
    gap: 8,
  },
  cardRaisedNative: {
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  cardRaisedWeb: {
    boxShadow: '0 3px 10px rgba(17, 19, 24, 0.08)',
  },
  cardPressedNative: {
    shadowOpacity: 0.03,
    transform: [{ translateY: 1 }],
  },
  cardPressedWeb: {
    boxShadow: '0 1px 4px rgba(17, 19, 24, 0.06)',
    transform: [{ translateY: 1 }],
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  copy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.full,
    borderWidth: 0,
  },
  pinChip: {
    paddingHorizontal: 7,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    ...typography.micro,
  },
  time: {
    marginLeft: 'auto',
    ...typography.micro,
  },
});
