/**
 * Kimi-style LLM model picker dropdown anchored below the chat header.
 */
import { memo, useCallback } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import type { ChatModelOption } from '../../query/models';
import { radii, spacing, typography, useTheme } from '../../theme';

export const ModelPickerMenu = memo(function ModelPickerMenu({
  visible,
  topOffset,
  models,
  currentModelId,
  onSelect,
  onDismiss,
}: {
  visible: boolean;
  topOffset: number;
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

  const panelBg = colors.surface.panel;
  const titleColor = colors.text.primary;
  const descColor = colors.text.secondary;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={[styles.overlay, { backgroundColor: colors.overlay.scrim }]} onPress={onDismiss}>
        <Pressable
          style={[
            styles.panel,
            {
              top: topOffset,
              backgroundColor: panelBg,
              shadowColor: colors.text.primary,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <ScrollView
            style={styles.scrollArea}
            bounces={false}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {models.length === 0 ? (
              <Text style={[styles.emptyText, { color: descColor }]}>{m.chat.modelPickerEmpty}</Text>
            ) : (
              models.map((model) => {
                const isActive = model.id === currentModelId;
                return (
                  <Pressable
                    key={model.id}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    onPress={() => handleSelect(model.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                  >
                    <View style={styles.rowText}>
                      <Text style={[styles.rowTitle, { color: titleColor }]} numberOfLines={1}>
                        {model.name ?? model.id}
                      </Text>
                      {model.description ? (
                        <Text style={[styles.rowDesc, { color: descColor }]} numberOfLines={2}>
                          {model.description}
                        </Text>
                      ) : null}
                    </View>
                    {isActive ? <Icon source="check" size={20} color={colors.accent.primary} /> : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  panel: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    borderRadius: radii.xl,
    paddingVertical: spacing.sm,
    maxHeight: 360,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 12,
  },
  scrollArea: {
    maxHeight: 344,
  },
  emptyText: {
    ...typography.ui,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg - spacing.xxs,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  rowPressed: {
    opacity: 0.75,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  rowTitle: {
    ...typography.heading,
    fontWeight: '600',
  },
  rowDesc: {
    ...typography.label,
  },
});
