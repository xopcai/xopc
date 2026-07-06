/**
 * Bottom sheet for quick agent/model switching within the chat screen.
 * Shows the agent list with current selection highlighted, tap to switch.
 */
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import type { ChatAgentOption } from '../../query/agents';
import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';

export const AgentPickerSheet = memo(function AgentPickerSheet({
  visible,
  agents,
  currentAgentId,
  onSelect,
  onDismiss,
}: {
  visible: boolean;
  agents: ChatAgentOption[];
  currentAgentId: string;
  onSelect: (agentId: string) => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const m = useMessages();

  const handleSelect = useCallback(
    (agentId: string) => {
      onSelect(agentId);
      onDismiss();
    },
    [onSelect, onDismiss],
  );

  return (
    <BottomSheetModal
      visible={visible}
      onDismiss={onDismiss}
      title={m.chat.agentPickerTitle}
      maxHeight="60%"
      scroll
    >
      {agents.map((agent) => {
        const isActive = agent.id === currentAgentId;
        return (
          <Pressable
            key={agent.id}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: isActive ? colors.accent.selectionBg : 'transparent' },
              pressed && { backgroundColor: colors.surface.hover },
            ]}
            onPress={() => handleSelect(agent.id)}
          >
            <View style={styles.rowContent}>
              <Text
                style={[
                  styles.agentName,
                  { color: isActive ? colors.accent.primary : colors.text.primary },
                  isActive && styles.agentNameActive,
                ]}
                numberOfLines={1}
              >
                {agent.name ?? agent.id}
              </Text>
              {agent.description ? (
                <Text style={[styles.agentDesc, { color: colors.text.tertiary }]} numberOfLines={1}>
                  {agent.description}
                </Text>
              ) : null}
            </View>
            {isActive ? <Icon source="check" size={18} color={colors.accent.primary} /> : null}
          </Pressable>
        );
      })}
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 2,
  },
  rowContent: {
    flex: 1,
    marginRight: 8,
  },
  agentName: {
    fontSize: 15,
    fontWeight: '500',
  },
  agentNameActive: {
    fontWeight: '600',
  },
  agentDesc: {
    fontSize: 12,
    marginTop: 2,
  },
});
