import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages, t } from '../../i18n/messages';
import type { NoteIndexEntry } from '../../query/notes';
import { radii, spacing, typography, useTheme } from '../../theme';
import type { InboxOrganizeSuggestion } from './ai-organize';

interface AiOrganizeSheetProps {
  visible: boolean;
  suggestions: InboxOrganizeSuggestion[];
  itemsById: Map<string, NoteIndexEntry>;
  applyingId?: string;
  onDismiss: () => void;
  onApply: (suggestion: InboxOrganizeSuggestion) => void;
}

const SUGGESTION_ICONS: Record<InboxOrganizeSuggestion['id'], string> = {
  bookmark: 'link-variant',
  todo: 'checkbox-marked-outline',
  voice: 'microphone-outline',
  media: 'image-outline',
};

export function AiOrganizeSheet({
  visible,
  suggestions,
  itemsById,
  applyingId,
  onDismiss,
  onApply,
}: AiOrganizeSheetProps) {
  const { colors } = useTheme();
  const m = useMessages();
  const im = m.inboxPage;

  return (
    <BottomSheetModal visible={visible} onDismiss={onDismiss} title={im.aiOrganizeTitle}>
      <View style={styles.list}>
        <Text style={[styles.hint, { color: colors.text.tertiary }]}>{im.aiOrganizeHint}</Text>
        {suggestions.length === 0 ? (
          <View style={[styles.emptyCard, { borderColor: colors.border.default }]}>
            <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>{im.aiOrganizeEmpty}</Text>
          </View>
        ) : suggestions.map((suggestion) => {
          const title = im.aiOrganizeSuggestions[suggestion.id].title;
          const subtitle = t(im.aiOrganizeSuggestions[suggestion.id].subtitle, { count: suggestion.count });
          const preview = suggestion.itemIds
            .slice(0, 2)
            .map((id) => itemsById.get(id)?.title || itemsById.get(id)?.snippet || im.aiOrganizeUntitled)
            .join(' · ');
          const busy = applyingId === suggestion.id;

          return (
            <View key={suggestion.id} style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
              <View style={[styles.iconWrap, { backgroundColor: colors.accent.soft }]}>
                <Icon source={SUGGESTION_ICONS[suggestion.id]} size={20} color={colors.accent.primary} />
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.title, { color: colors.text.primary }]}>{title}</Text>
                <Text style={[styles.subtitle, { color: colors.text.tertiary }]}>{subtitle}</Text>
                {preview ? (
                  <Text numberOfLines={1} style={[styles.preview, { color: colors.text.secondary }]}>{preview}</Text>
                ) : null}
              </View>
              <Pressable
                disabled={busy || Boolean(applyingId)}
                style={({ pressed }) => [
                  styles.applyButton,
                  { backgroundColor: colors.accent.selectionBg, opacity: busy || applyingId ? 0.55 : pressed ? 0.72 : 1 },
                ]}
                onPress={() => onApply(suggestion)}
              >
                <Text style={[styles.applyText, { color: colors.accent.primary }]}>
                  {busy ? im.aiOrganizeApplying : im.aiOrganizeApply}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  emptyCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.lg,
  },
  emptyText: {
    ...typography.label,
    textAlign: 'center',
  },
  hint: { ...typography.caption },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...typography.label,
    fontWeight: '700',
  },
  subtitle: {
    ...typography.caption,
  },
  preview: {
    ...typography.caption,
  },
  applyButton: {
    minHeight: 36,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyText: {
    ...typography.caption,
    fontWeight: '700',
  },
});
