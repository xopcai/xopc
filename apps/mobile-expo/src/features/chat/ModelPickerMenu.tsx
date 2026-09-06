import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages } from '../../i18n/messages';
import { chatModelDisplayName, type ChatModelOption } from '../../query/models';
import { radii, spacing, typography, useTheme } from '../../theme';

export const ModelPickerMenu = memo(function ModelPickerMenu({
  visible,
  models,
  currentModelId,
  onSelect,
  onDismiss,
}: {
  visible: boolean;
  models: ChatModelOption[];
  currentModelId: string;
  onSelect: (modelId: string) => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const m = useMessages();

  const handleSelect = useCallback(
    (modelId: string) => {
      onSelect(modelId);
      onDismiss();
    },
    [onDismiss, onSelect],
  );

  const titleColor = colors.text.primary;
  const descColor = colors.text.secondary;

  return (
    <BottomSheetModal
      visible={visible}
      onDismiss={onDismiss}
      title={m.chat.modelPickerTitle}
      subtitle={m.chat.modelPickerHint}
      maxHeight="72%"
      scroll={models.length > 0}
      testID="chat-model-picker-sheet"
    >
      {models.length === 0 ? (
        <Text style={[styles.emptyText, { color: descColor }]}>{m.chat.modelPickerEmpty}</Text>
      ) : (
        models.map((model) => {
          const isActive = model.id === currentModelId;
          const title = chatModelDisplayName(model);
          return (
            <Pressable
              key={model.id}
              style={({ pressed }) => [
                styles.row,
                isActive && { backgroundColor: colors.accent.selectionBg },
                pressed && { backgroundColor: colors.surface.pressed },
              ]}
              onPress={() => handleSelect(model.id)}
              accessibilityRole="button"
              accessibilityLabel={title}
              accessibilityState={{ selected: isActive }}
            >
              <View style={styles.rowText}>
                <Text
                  style={[
                    styles.rowTitle,
                    { color: isActive ? colors.accent.primary : titleColor },
                  ]}
                  numberOfLines={2}
                >
                  {title}
                </Text>
                {model.description ? (
                  <Text style={[styles.rowDesc, { color: descColor }]} numberOfLines={2}>
                    {model.description}
                  </Text>
                ) : null}
              </View>
              <View style={styles.checkSlot}>
                {isActive ? <Icon source="check" size={20} color={colors.accent.primary} /> : null}
              </View>
            </Pressable>
          );
        })
      )}
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  emptyText: {
    ...typography.ui,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.xxs,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  rowTitle: {
    ...typography.ui,
    fontWeight: '600',
  },
  rowDesc: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  checkSlot: {
    width: 20,
    alignItems: 'center',
  },
});
