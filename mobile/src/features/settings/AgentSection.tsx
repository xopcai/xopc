/**
 * Agent settings section — shows configured agents, default agent selection.
 *
 * Fetches agent list from the gateway and displays them.
 * Users can see which agent is the default and what agents are available.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Button, Chip, List, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { fetchChatAgents } from '../../query/agents';
import { queryKeys } from '../../query/keys';
import { useGatewayConfigured } from '../../query/sessions';

export const AgentSection = memo(function AgentSection() {
  const m = useMessages();
  const s = m.settings;
  const configured = useGatewayConfigured();
  const queryClient = useQueryClient();

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents,
    queryFn: fetchChatAgents,
    enabled: configured,
  });

  if (!configured) return null;

  return (
    <View style={styles.section}>
      <Text variant="titleMedium" style={styles.heading}>
        {s.agents}
      </Text>

      {agentsQuery.isLoading ? (
        <ActivityIndicator size="small" style={styles.loader} />
      ) : agentsQuery.isError ? (
        <View style={styles.errorRow}>
          <Text variant="bodySmall" style={styles.errorText}>
            {s.agentLoadFailed}
          </Text>
          <Button
            mode="text"
            compact
            onPress={() => void queryClient.invalidateQueries({ queryKey: queryKeys.agents })}
          >
            {s.retry}
          </Button>
        </View>
      ) : agentsQuery.data && agentsQuery.data.items.length > 0 ? (
        <>
          <Text variant="labelMedium" style={styles.label}>
            {s.defaultAgent}
          </Text>
          {agentsQuery.data.items.map((agent) => {
            const isDefault = agent.id === agentsQuery.data?.defaultId;
            return (
              <List.Item
                key={agent.id}
                title={agent.name || agent.id}
                description={agent.description || agent.id}
                left={(props) => <List.Icon {...props} icon="robot" />}
                right={
                  isDefault
                    ? () => (
                        <Chip mode="flat" compact style={styles.defaultChip}>
                          Default
                        </Chip>
                      )
                    : undefined
                }
                style={styles.agentItem}
              />
            );
          })}
        </>
      ) : (
        <Text variant="bodySmall" style={styles.emptyText}>
          {s.agentListEmpty}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    marginTop: 24,
  },
  heading: {
    marginBottom: 12,
  },
  label: {
    marginBottom: 8,
    opacity: 0.7,
  },
  loader: {
    marginTop: 8,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    opacity: 0.6,
  },
  emptyText: {
    opacity: 0.6,
  },
  agentItem: {
    paddingLeft: 0,
  },
  defaultChip: {
    alignSelf: 'center',
  },
});
