/**
 * Confirmation dialog for deleting a session.
 */
import { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Button, Dialog, Paragraph, Portal } from 'react-native-paper';

import { t, useMessages } from '../../i18n/messages';

type DeleteConfirmDialogProps = {
  visible: boolean;
  sessionName: string;
  onDismiss: () => void;
  onConfirm: () => void;
  loading?: boolean;
};

export const DeleteConfirmDialog = memo(function DeleteConfirmDialog({
  visible,
  sessionName,
  onDismiss,
  onConfirm,
  loading = false,
}: DeleteConfirmDialogProps) {
  const m = useMessages();

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title>{m.deleteDialog.title}</Dialog.Title>
        <Dialog.Content>
          <Paragraph>
            {t(m.deleteDialog.message, { name: sessionName })}
          </Paragraph>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss} disabled={loading}>
            {m.deleteDialog.cancel}
          </Button>
          <Button
            onPress={onConfirm}
            disabled={loading}
            loading={loading}
            textColor="#EF4444"
          >
            {m.deleteDialog.delete}
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
