/**
 * Agents page — read-only list of configured agents from the gateway.
 *
 * Displays agent cards with name, id, description, and default badge.
 * Tapping an agent navigates to a new chat session with that agent.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, StyleSheet, useColorScheme, View } from 'react-native';
import { ActivityIndicator, Button, Chip, Icon, Text } from 'react-native-paper';

import { useMessages } from '../src/i18n/messages';
import { fetchChatAgents, type ChatAgentOption } from '../src/query/agents';
import { queryKeys } from '../src/query/keys';
import { createSession, useGatewayConfigured } from '../src/query/sessions';

export default function AgentsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isDark = useColorScheme() === 'dark';
  const configured = useGatewayConfigured();
  const m = useMessages();
  const am = m.agentsPage;

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents,
    queryFn: fetchChatAgents,
    enabled: configured,
  });

  const createMut = useMutation({
    mutationFn: (agentId: string) => createSession(agentId),
    onSuccess: (key) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      router.replace({ pathname: '/', params: { k: key } });
    },
  });

  const handleChatWith = useCallback(
    (agentId: string) => {
      createMut.mutate(agentId);
    },
    [createMut],
  );

  const agents = agentsQuery.data?.items ?? [];
  const defaultId = agentsQuery.data?.defaultId ?? 'main';

  const cardBg = isDark ? '#1A2E1E' : '#F1F8E9';
  const cardBorder = isDark ? '#2E5233' : '#C8E6C9';
  const textPrimary = isDark ? '#E5E7EB' : '#1F2937';
  const textSecondary = isDark ? '#9CA3AF' : '#6B7280';
  const accentBg = isDark ? 'rgba(59,130,246,0.15)' : '#EFF6FF';
  const accentText = isDark ? '#60A5FA' : '#2563EB';

  const renderAgent = useCallback(
    ({ item }: { item: ChatAgentOption }) => {
      const isDefault = item.id === defaultId;
      const title = item.name?.trim() || item.id;
      return (
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconCircle, { backgroundColor: accentBg }]}>
              <Icon source="robot" size={24} color={accentText} />
            </View>
            <View style={styles.cardTitleArea}>
              <View style={styles.titleRow}>
                <Text style={[styles.cardTitle, { color: textPrimary }]} numberOfLines={1}>
                  {title}
                </Text>
                {isDefault ? (
                  <Chip mode="flat" compact style={styles.defaultChip} textStyle={styles.defaultChipText}>
                    {am.defaultBadge}
                  </Chip>
                ) : null}
              </View>
              <Text style={[styles.cardId, { color: textSecondary }]} numberOfLines={1}>
                {item.id}
              </Text>
            </View>
          </View>

          {item.description ? (
            <Text style={[styles.cardDesc, { color: textSecondary }]} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}

          <Button
            mode="contained-tonal"
            compact
            icon="chat-outline"
            style={styles.chatButton}
            onPress={() => handleChatWith(item.id)}
            loading={createMut.isPending && createMut.variables === item.id}
            disabled={createMut.isPending}
          >
            {am.chatWith}
          </Button>
        </View>
      );
    },
    [defaultId, cardBg, cardBorder, textPrimary, textSecondary, accentBg, accentText, am, handleChatWith, createMut],
  );

  if (!configured) {
    return (
      <View style={styles.center}>
        <Text style={{ opacity: 0.6 }}>{m.sessions.gatewayNotConfigured}</Text>
      </View>
    );
  }

  if (agentsQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (agentsQuery.isError) {
    return (
      <View style={styles.center}>
        <Text style={{ opacity: 0.6, marginBottom: 12 }}>{am.loadFailed}</Text>
        <Button
          mode="outlined"
          onPress={() => void queryClient.invalidateQueries({ queryKey: queryKeys.agents })}
        >
          {m.common.retry}
        </Button>
      </View>
    );
  }

  if (agents.length === 0) {
    return (
      <View style={styles.center}>
        <Icon source="robot-off-outline" size={48} color={textSecondary} />
        <Text style={[styles.emptyText, { color: textSecondary }]}>{am.empty}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={agents}
      keyExtractor={(item) => item.id}
      renderItem={renderAgent}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleArea: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  cardId: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  defaultChip: {
    height: 22,
  },
  defaultChipText: {
    fontSize: 10,
    lineHeight: 14,
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 19,
  },
  chatButton: {
    alignSelf: 'flex-start',
    borderRadius: 20,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
  },
});
