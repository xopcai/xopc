import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages } from '../../i18n/messages';
import { radii, spacing, typography, useTheme } from '../../theme';

interface AiOrganizeSheetProps {
  visible: boolean;
  onDismiss: () => void;
}

/** Placeholder — AI organize will be implemented after LLM integration. */
export function AiOrganizeSheet({ visible, onDismiss }: AiOrganizeSheetProps) {
  const { colors } = useTheme();
  const m = useMessages();
  const im = m.inboxPage;

  return (
    <BottomSheetModal visible={visible} onDismiss={onDismiss} title={im.aiOrganizeTitle}>
      <View style={styles.list}>
        <View style={[styles.emptyCard, { borderColor: colors.border.default }]}>
          <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>{im.aiOrganizeComingSoon}</Text>
        </View>
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
});
