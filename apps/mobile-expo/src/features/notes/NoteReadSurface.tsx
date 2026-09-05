import { memo, useMemo } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { spacing, typography, useTheme } from '../../theme';
import { MarkdownView } from '../chat/MarkdownView';

import { buildNoteReadBlocks } from './note-read-blocks';

export const NoteReadSurface = memo(function NoteReadSurface({
  title,
  markdown,
  tags,
  attachmentSrcMap,
  untitledLabel,
}: {
  title: string;
  markdown: string;
  tags?: string[];
  attachmentSrcMap: Record<string, string>;
  untitledLabel: string;
}) {
  const { colors } = useTheme();
  const blocks = useMemo(() => buildNoteReadBlocks(markdown, attachmentSrcMap), [attachmentSrcMap, markdown]);
  return <ScrollView
    style={styles.scroll}
    contentContainerStyle={styles.content}
    keyboardShouldPersistTaps="handled"
    showsVerticalScrollIndicator={false}
  >
    <Text style={[styles.title, { color: colors.text.primary }]}>{title.trim() || untitledLabel}</Text>
    {tags?.length ? <View style={styles.tags}>{tags.map((tag) => <View key={tag} style={[styles.tag, { backgroundColor: colors.accent.selectionBg }]}><Text style={[styles.tagText, { color: colors.accent.primary }]}>{tag}</Text></View>)}</View> : null}
    <View style={styles.body}>
      {blocks.map((block) => block.kind === 'markdown'
        ? <MarkdownView key={block.key} content={block.content} allowTrailingMargin />
        : block.uri
          ? <Image key={block.key} source={{ uri: block.uri }} accessibilityLabel={block.alt} resizeMode="contain" style={[styles.image, { backgroundColor: colors.surface.panel }]} />
          : <View key={block.key} style={[styles.imagePlaceholder, { backgroundColor: colors.surface.panel }]}><Text style={{ color: colors.text.tertiary }}>{block.alt}</Text></View>)}
    </View>
  </ScrollView>;
});

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: 140 },
  title: { fontSize: 30, lineHeight: 37, fontWeight: '800' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  tag: { borderRadius: 12, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  tagText: { ...typography.caption, fontWeight: '600' },
  body: { marginTop: spacing.xl, gap: spacing.md },
  image: { width: '100%', minHeight: 220, maxHeight: 420, borderRadius: 12 },
  imagePlaceholder: { minHeight: 96, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
});
