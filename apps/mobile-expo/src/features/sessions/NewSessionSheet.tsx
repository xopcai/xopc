/**
 * Bottom sheet for creating a new session.
 * Allows selecting an agent before creating the session.
 */
import { memo, useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, Dialog, Portal, RadioButton, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import type { ChatAgentOption } from '../../query/agents';
import { radii, spacing } from '../../theme';
import { useTheme } from '../../theme/useTheme';

type NewSessionSheetProps = {
  visible: boolean;
  agents: ChatAgentOption[];
  defaultAgentId: string;
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  onDismiss: () => void;
  onCreate: () => void;
  loading?: boolean;
};

export const NewSessionSheet = memo(function NewSessionSheet({
  visible,
  agents,
  defaultAgentId,
  selectedAgentId,
  onSelectAgent,
  onDismiss,
  onCreate,
  loading = false,
}: NewSessionSheetProps) {
  const { colors } = useTheme();
  const m = useMessages();

  const handleCreate = useCallback(() => {
    onCreate();
  }, [onCreate]);

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title>{m.newSession.title}</Dialog.Title>
        <Dialog.Content>
          {agents.length > 1 ? (
            <>
              <Text variant="labelMedium" style={styles.label}>
                {m.newSession.selectAgent}
              </Text>
              <ScrollView style={styles.agentList}>
                <RadioButton.Group
                  value={selectedAgentId}
                  onValueChange={onSelectAgent}
                >
                  {agents.map((agent) => (
                    <RadioButton.Item
                      key={agent.id}
                      label={
                        agent.name
                          ? `${agent.name}${agent.id === defaultAgentId ? ` ${m.newSession.defaultSuffix}` : ''}`
                          : `${agent.id}${agent.id === defaultAgentId ? ` ${m.newSession.defaultSuffix}` : ''}`
                      }
                      value={agent.id}
                      style={[
                        styles.agentItem,
                        {
                          backgroundColor:
                            selectedAgentId === agent.id
                              ? colors.accent.selectionBg
                              : 'transparent',
                        },
                      ]}
                    />
                  ))}
                </RadioButton.Group>
              </ScrollView>
            </>
          ) : (
            <Text variant="bodyMedium" style={{ color: colors.text.secondary }}>
              {m.newSession.creatingHint.replace('{{agentName}}', agents[0]?.name ? ` with ${agents[0].name}` : '')}
            </Text>
          )}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss} disabled={loading}>
            {m.newSession.cancel}
          </Button>
          <Button
            mode="contained"
            onPress={handleCreate}
            disabled={loading}
            loading={loading}
          >
            {m.newSession.create}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
});

const styles = StyleSheet.create({
  dialog: {
    maxWidth: 420,
    alignSelf: 'center',
  },
  label: {
    marginBottom: spacing.sm,
    opacity: 0.7,
  },
  agentList: {
    maxHeight: 260,
  },
  agentItem: {
    borderRadius: radii.sm,
    marginBottom: spacing.xxs,
  },
});
