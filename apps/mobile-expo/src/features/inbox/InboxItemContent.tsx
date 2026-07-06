import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import type { NoteIndexEntry } from '../../query/notes';
import { spacing, typography, useTheme } from '../../theme';
import { resolveNoteListDisplay } from '../notes/note-list-display';
import { readLocalNote } from '../notes/notes-local';

export type InboxItemContentProps = {
  note: NoteIndexEntry;
};

export function InboxItemContent({ note }: InboxItemContentProps) {
  const { colors } = useTheme();
  const m = useMessages();
  const im = m.inboxPage;
  const pm = m.notesPage;

  const display = useMemo(
    () => resolveNoteListDisplay(note, {
      untitled: pm.untitledNote,
      cachedNote: readLocalNote(note.id),
      kindLabels: pm,
      emptyHints: im.itemHints,
      timeLabels: im.time,
    }),
    [im.itemHints, im.time, note, pm],
  );

  const detailLine = display.subtitle || display.metaLine;

  return (
    <View style={styles.copy}>
      <Text
        numberOfLines={1}
        style={[styles.title, { color: colors.text.primary }]}
      >
        {display.title}
      </Text>
      <Text
        numberOfLines={1}
        style={[styles.detail, { color: colors.text.secondary }]}
      >
        {detailLine}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1, gap: spacing.xs, minWidth: 0 },
  title: { ...typography.body, fontWeight: '600' },
  detail: { ...typography.label },
});
