/**
 * Agents — browse gateway agents, inspect their capabilities, or start a chat.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';

import { FloatingHeader } from '../../components/FloatingHeader';
import { useMessages } from '../../i18n/messages';
import { dismissOrHome, openChat, useDismissOnHardwareBack } from '../../lib/navigation';
import { fetchChatAgents, type ChatAgentOption } from '../../query/agents';
import { queryKeys } from '../../query/keys';
import { createSession, useGatewayConfigured } from '../../query/sessions';
import { invalidateSessionLists } from '../../query/workspace-sync';
import { usePreferencesStore } from '../../stores/preferences-store';
import { useSettingsColors } from '../settings/settings-ui';
import { pickEffectiveDefaultId } from '../settings/use-set-default-agent';
import { AgentAvatar } from './AgentAvatar';

function displayName(agent: ChatAgentOption): string {
  return agent.name?.trim() || agent.id;
}

function matchesAgent(agent: ChatAgentOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    agent.id,
    agent.name,
    agent.description,
    agent.workspace,
    agent.model?.primary,
  ].some((value) => value?.toLowerCase().includes(q));
}

export function AgentsScreen() {
  const router = useRouter();
  useDismissOnHardwareBack(router);
  const queryClient = useQueryClient();
  const colors = useSettingsColors();
  const configured = useGatewayConfigured();
  const m = useMessages();
  const am = m.agentsPage;
  const localOverride = usePreferencesStore((s) => s.defaultAgentId);
  const [search, setSearch] = useState('');

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents,
    queryFn: fetchChatAgents,
    enabled: configured,
  });

  const createMut = useMutation({
    mutationFn: (agentId: string) => createSession(agentId),
    onSuccess: (key) => {
      invalidateSessionLists(queryClient);
      openChat(router, key, { replace: true });
    },
  });

  const agents = agentsQuery.data?.items ?? [];
  const effectiveId = pickEffectiveDefaultId(agentsQuery.data, localOverride);
  const filteredAgents = useMemo(
    () => agents.filter((agent) => matchesAgent(agent, search)),
    [agents, search],
  );

  const handleChatWith = useCallback(
    (agentId: string) => {
      createMut.mutate(agentId);
    },
    [createMut],
  );

  const openAgent = useCallback(
    (agentId: string) => {
      router.push({ pathname: '/ai/agents/[id]', params: { id: agentId } });
    },
    [router],
  );

  if (!configured) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
        <FloatingHeader title={am.title} onBack={() => dismissOrHome(router)} />
        <View style={styles.center}>
          <Text style={{ color: colors.textMuted }}>{m.sessions.gatewayNotConfigured}</Text>
        </View>
      </View>
    );
  }

  if (agentsQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
        <FloatingHeader title={am.title} onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      </View>
    );
  }

  if (agentsQuery.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
        <FloatingHeader title={am.title} onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>{am.loadFailed}</Text>
          <Button mode="outlined" onPress={() => void queryClient.invalidateQueries({ queryKey: queryKeys.agents })}>
            {m.common.retry}
          </Button>
        </View>
      </View>
    );
  }

  if (agents.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
        <FloatingHeader title={am.title} onBack={() => router.back()} />
        <View style={styles.center}>
          <Icon source="robot-off-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>{am.empty}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
      <FloatingHeader title={am.title} onBack={() => router.back()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.searchBox, { backgroundColor: colors.card }]}>
          <Icon source="magnify" size={20} color={colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={am.searchPlaceholder}
            placeholderTextColor={colors.textMuted}
            style={[styles.searchInput, { color: colors.text }]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {search.trim() ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Icon source="close-circle" size={20} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {filteredAgents.length === 0 ? (
          <Text style={[styles.noResults, { color: colors.textMuted }]}>{am.noResults}</Text>
        ) : (
          <View style={styles.cards}>
            {filteredAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                selected={agent.id === effectiveId}
                chatLoading={createMut.isPending && createMut.variables === agent.id}
                onOpen={() => openAgent(agent.id)}
                onChat={() => handleChatWith(agent.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function AgentCard({
  agent,
  selected,
  chatLoading,
  onOpen,
  onChat,
}: {
  agent: ChatAgentOption;
  selected: boolean;
  chatLoading?: boolean;
  onOpen: () => void;
  onChat: () => void;
}) {
  const colors = useSettingsColors();
  const am = useMessages().agentsPage;
  const name = displayName(agent);
  const subtitle = agent.description?.trim() || agent.id;

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
      >
        <View style={styles.cardHeader}>
          <AgentAvatar agentId={agent.id} avatar={agent.avatar} size={44} />
          <View style={styles.cardTitle}>
            <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
              {name}
            </Text>
          </View>
          {selected ? (
            <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
              <Text style={[styles.badgeText, { color: colors.accent }]}>{am.defaultBadge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.description, { color: colors.textMuted }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </Pressable>

      <Pressable
        disabled={chatLoading}
        onPress={onChat}
        style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]}
        hitSlop={4}
      >
        {chatLoading ? (
          <ActivityIndicator size={18} />
        ) : (
          <Icon source="chat-plus-outline" size={22} color={colors.accent} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
  },
  searchBox: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    fontSize: 16,
    paddingVertical: 0,
  },
  noResults: {
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  cards: {
    gap: 12,
  },
  card: {
    borderRadius: 12,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 14,
    paddingVertical: 12,
  },
  pressed: {
    opacity: 0.72,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    fontSize: 17,
    fontWeight: '700',
  },
  badge: {
    minHeight: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  description: {
    marginTop: 4,
    marginLeft: 56,
    fontSize: 13,
    lineHeight: 18,
  },
  chatButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
