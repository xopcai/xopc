/**
 * Kimi-style bottom sheet dialog for renaming a session.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { IconButton, Text, TextInput } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';

type RenameDialogProps = {
  visible: boolean;
  currentName: string;
  onDismiss: () => void;
  onRename: (name: string) => void;
  loading?: boolean;
};

export const RenameDialog = memo(function RenameDialog({
  visible,
  currentName,
  onDismiss,
  onRename,
  loading = false,
}: RenameDialogProps) {
  const m = useMessages();
  const { colors } = useTheme();
  const [draft, setDraft] = useState(currentName);

  useEffect(() => {
    if (visible) setDraft(currentName);
  }, [visible, currentName]);

  const handleSubmit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed) onRename(trimmed);
  }, [draft, onRename]);

  const canSubmit = Boolean(draft.trim()) && !loading;

  return (
    <BottomSheetModal
      visible={visible}
      onDismiss={onDismiss}
      title={m.renameDialog.title}
      keyboardAvoiding
      maxHeight="48%"
      headerAction={<IconButton icon="close" size={20} onPress={onDismiss} disabled={loading} />}
    >
      <View style={styles.content}>
          <TextInput
            mode="outlined"
            value={draft}
            onChangeText={setDraft}
            placeholder={m.renameDialog.placeholder}
            autoFocus
            onSubmitEditing={handleSubmit}
            disabled={loading}
            outlineColor={colors.border.default}
            activeOutlineColor={colors.accent.primary}
            textColor={colors.text.primary}
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
            contentStyle={styles.inputContent}
          />

          <View style={styles.actions}>
            <Pressable
              style={[styles.actionButton, { backgroundColor: colors.surface.input }]}
              onPress={onDismiss}
              disabled={loading}
            >
              <Text style={[styles.actionLabel, { color: colors.text.primary }]}>{m.renameDialog.cancel}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.actionButton,
                {
                  backgroundColor: canSubmit ? colors.accent.primary : colors.surface.input,
                },
              ]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              <Text
                style={[
                  styles.actionLabel,
                  { color: canSubmit ? colors.accent.onPrimary : colors.text.tertiary },
                ]}
              >
                {m.renameDialog.confirm}
              </Text>
            </Pressable>
          </View>
        </View>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
  },
  input: {
    marginBottom: 16,
    backgroundColor: 'transparent',
  },
  inputContent: {
    fontSize: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});
