/**
 * Channels page — read-only status view of configured messaging channels.
 *
 * Displays channel cards with name, enabled/disabled state, and connection status.
 * Data comes from GET /api/channels/status.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { FlatList, StyleSheet, useColorScheme, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';

import { useMessages } from '../src/i18n/messages';
import { fetchChannelsStatus, type ChannelStatusEntry } from '../src/query/channels';
import { queryKeys } from '../src/query/keys';
import { useGatewayConfigured } from '../src/query/sessions';

/** Map channel name to a Material Community icon. */
function channelIcon(name: string): string {
  switch (name.toLowerCase()) {
    case 'telegram':
      return 'send';
    case 'weixin':
      return 'wechat';
    case 'feishu':
      return 'bird';
    case 'discord':
      return 'discord';
    case 'slack':
      return 'slack';
    default:
      return 'message-outline';
  }
}

/** Capitalize the first letter of a channel name for display. */
function channelDisplayName(name: string): string {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export default function ChannelsScreen() {
  const queryClient = useQueryClient();
  const isDark = useColorScheme() === 'dark';
  const configured = useGatewayConfigured();
  const m = useMessages();
  const cm = m.channelsPage;

  const channelsQuery = useQuery({
    queryKey: queryKeys.channels,
    queryFn: fetchChannelsStatus,
    enabled: configured,
  });

  const channels = channelsQuery.data ?? [];

  const cardBg = isDark ? '#1A2E1E' : '#F1F8E9';
  const cardBorder = isDark ? '#2E5233' : '#C8E6C9';
  const textPrimary = isDark ? '#E5E7EB' : '#1F2937';
  const textSecondary = isDark ? '#9CA3AF' : '#6B7280';
  const enabledColor = isDark ? '#86EFAC' : '#16A34A';
  const disabledColor = isDark ? '#FCA5A5' : '#DC2626';
  const connectedColor = isDark ? '#93C5FD' : '#2563EB';
  const disconnectedColor = isDark ? '#6B7280' : '#9CA3AF';

  const renderChannel = useCallback(
    ({ item }: { item: ChannelStatusEntry }) => {
      return (
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconCircle, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F3F4F6' }]}>
              <Icon source={channelIcon(item.name)} size={26} color={textSecondary} />
            </View>
            <View style={styles.cardTitleArea}>
              <Text style={[styles.cardTitle, { color: textPrimary }]} numberOfLines={1}>
                {channelDisplayName(item.name)}
              </Text>
            </View>
          </View>

          <View style={styles.badgeRow}>
            {/* Enabled/Disabled */}
            <View style={[styles.badge, { backgroundColor: item.enabled ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)' }]}>
              <View style={[styles.statusDot, { backgroundColor: item.enabled ? enabledColor : disabledColor }]} />
              <Text style={[styles.badgeText, { color: item.enabled ? enabledColor : disabledColor }]}>
                {item.enabled ? cm.enabled : cm.disabled}
              </Text>
            </View>

            {/* Connected/Disconnected */}
            <View style={[styles.badge, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F3F4F6' }]}>
              <View style={[styles.statusDot, { backgroundColor: item.connected ? connectedColor : disconnectedColor }]} />
              <Text style={[styles.badgeText, { color: item.connected ? connectedColor : disconnectedColor }]}>
                {item.connected ? cm.connected : cm.disconnected}
              </Text>
            </View>
          </View>
        </View>
      );
    },
    [cardBg, cardBorder, textPrimary, textSecondary, enabledColor, disabledColor, connectedColor, disconnectedColor, isDark, cm],
  );

  if (!configured) {
    return (
      <View style={styles.center}>
        <Text style={{ opacity: 0.6 }}>{m.sessions.gatewayNotConfigured}</Text>
      </View>
    );
  }

  if (channelsQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (channelsQuery.isError) {
    return (
      <View style={styles.center}>
        <Text style={{ opacity: 0.6, marginBottom: 12 }}>{cm.loadFailed}</Text>
        <Button
          mode="outlined"
          onPress={() => void queryClient.invalidateQueries({ queryKey: queryKeys.channels })}
        >
          {m.common.retry}
        </Button>
      </View>
    );
  }

  if (channels.length === 0) {
    return (
      <View style={styles.center}>
        <Icon source="swap-horizontal" size={48} color={textSecondary} />
        <Text style={[styles.emptyText, { color: textSecondary }]}>{cm.empty}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={channels}
      keyExtractor={(item) => item.name}
      renderItem={renderChannel}
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
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleArea: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
  },
});
