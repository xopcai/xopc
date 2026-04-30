import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { ActivityIndicator, Banner, FAB, List, Text } from 'react-native-paper';

import { fetchChatAgents } from '../src/query/agents';
import { queryKeys } from '../src/query/keys';
import { createSession, fetchSessionsList, useGatewayConfigured } from '../src/query/sessions';
import { useGatewayStore } from '../src/stores/gateway-store';

export default function SessionsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const configured = useGatewayConfigured();
  const unauthorized = useGatewayStore((s) => s.unauthorized);
  const baseUrl = useGatewayStore((s) => s.baseUrl);

  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: fetchSessionsList,
    enabled: configured,
  });

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents,
    queryFn: fetchChatAgents,
    enabled: configured,
  });

  const createMut = useMutation({
    mutationFn: createSession,
    onSuccess: (key) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      router.push({ pathname: '/chat', params: { k: key } });
    },
  });

  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
  }, [queryClient]);

  if (!configured) {
    return (
      <View style={{ flex: 1, padding: 16, justifyContent: 'center' }}>
        <Text variant="bodyLarge" style={{ marginBottom: 12 }}>
          Set your gateway base URL and optional token in Settings to load sessions.
        </Text>
        <Link href="/settings" asChild>
          <Text style={{ color: '#2563eb' }}>Open settings</Text>
        </Link>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {unauthorized ? (
        <Banner visible actions={[{ label: 'Settings', onPress: () => router.push('/settings') }]} icon="alert">
          Unauthorized (401). Check your bearer token.
        </Banner>
      ) : null}
      {sessionsQuery.isError ? (
        <Banner visible actions={[{ label: 'Retry', onPress: onRefresh }]} icon="alert">
          {sessionsQuery.error instanceof Error ? sessionsQuery.error.message : 'Failed to load sessions'}
        </Banner>
      ) : null}
      {sessionsQuery.isLoading ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={sessionsQuery.data ?? []}
          keyExtractor={(item) => item.key}
          refreshControl={<RefreshControl refreshing={sessionsQuery.isFetching} onRefresh={onRefresh} />}
          ListHeaderComponent={
            <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
              <Text variant="labelSmall" style={{ opacity: 0.7 }} numberOfLines={1}>
                {baseUrl}
              </Text>
              {agentsQuery.data ? (
                <Text variant="labelSmall" style={{ opacity: 0.7 }} numberOfLines={2}>
                  Default agent: {agentsQuery.data.defaultId} ({agentsQuery.data.items.length} configured)
                </Text>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <List.Item
              title={item.name || item.key.slice(-24)}
              description={`${item.messageCount} messages · ${item.updatedAt}`}
              onPress={() => router.push({ pathname: '/chat', params: { k: item.key } })}
            />
          )}
        />
      )}
      <FAB
        icon="cog"
        mode="flat"
        style={{ position: 'absolute', right: 88, bottom: 16 }}
        onPress={() => router.push('/settings')}
      />
      <FAB
        icon="plus"
        style={{ position: 'absolute', right: 16, bottom: 16 }}
        loading={createMut.isPending}
        onPress={() => createMut.mutate()}
      />
    </View>
  );
}
