/**
 * Dialog for renaming a session.
 * Shows a text input pre-filled with the current name.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button, Dialog, Portal, TextInput } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';

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
  const [draft, setDraft] = useState(currentName);

  useEffect(() => {
    if (visible) setDraft(currentName);
  }, [visible, currentName]);

  const handleSubmit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed) onRename(trimmed);
  }, [draft, onRename]);

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title>{m.renameDialog.title}</Dialog.Title>
        <Dialog.Content>
          <TextInput
            mode="outlined"
            value={draft}
            onChangeText={setDraft}
            placeholder={m.renameDialog.placeholder}
            autoFocus
            onSubmitEditing={handleSubmit}
            disabled={loading}
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss} disabled={loading}>
            {m.renameDialog.cancel}
          </Button>
          <Button
            onPress={handleSubmit}
            disabled={!draft.trim() || loading}
            loading={loading}
          >
            {m.renameDialog.rename}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
});

const styles = StyleSheet.create({
  dialog: {
    maxWidth: 400,
    alignSelf: 'center',
  },
});
