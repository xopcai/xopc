/**
 * Skills page — read-only list of installed skills from the gateway.
 *
 * Displays skill entries with name, description, source badge, and enabled status.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { FlatList, StyleSheet, useColorScheme, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';

import { useMessages } from '../src/i18n/messages';
import { queryKeys } from '../src/query/keys';
import { fetchSkills, type SkillCatalogEntry } from '../src/query/skills';
import { useGatewayConfigured } from '../src/query/sessions';

function sourceLabel(source: string, labels: Record<string, string>): string {
  switch (source) {
    case 'builtin':
      return labels.sourceBuiltin;
    case 'workspace':
      return labels.sourceWorkspace;
    case 'global':
      return labels.sourceGlobal;
    case 'extra':
      return labels.sourceExtra;
    default:
      return source;
  }
}

/** Derive an icon from skill name's first letter. */
function skillIcon(name: string): string {
  const firstChar = name.charAt(0).toLowerCase();
  if (firstChar >= 'a' && firstChar <= 'z') return `alpha-${firstChar}-box-outline`;
  return 'puzzle-outline';
}

export default function SkillsScreen() {
  const queryClient = useQueryClient();
  const isDark = useColorScheme() === 'dark';
  const configured = useGatewayConfigured();
  const m = useMessages();
  const sm = m.skillsPage;

  const skillsQuery = useQuery({
    queryKey: queryKeys.skills,
    queryFn: fetchSkills,
    enabled: configured,
  });

  const catalog = skillsQuery.data?.catalog ?? [];

  const cardBg = isDark ? '#1A2E1E' : '#F1F8E9';
  const cardBorder = isDark ? '#2E5233' : '#C8E6C9';
  const textPrimary = isDark ? '#E5E7EB' : '#1F2937';
  const textSecondary = isDark ? '#9CA3AF' : '#6B7280';
  const badgeBg = isDark ? 'rgba(255,255,255,0.08)' : '#F3F4F6';
  const badgeText = isDark ? '#D1D5DB' : '#4B5563';
  const enabledColor = isDark ? '#86EFAC' : '#16A34A';
  const disabledColor = isDark ? '#FCA5A5' : '#DC2626';

  const renderSkill = useCallback(
    ({ item }: { item: SkillCatalogEntry }) => {
      return (
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={styles.cardHeader}>
            <Icon source={skillIcon(item.name)} size={28} color={textSecondary} />
            <View style={styles.cardTitleArea}>
              <Text style={[styles.cardTitle, { color: textPrimary }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text
                style={[styles.cardDesc, { color: textSecondary }]}
                numberOfLines={2}
              >
                {item.description || '—'}
              </Text>
            </View>
          </View>

          <View style={styles.badgeRow}>
            <View style={[styles.badge, { backgroundColor: badgeBg }]}>
              <Text style={[styles.badgeText, { color: badgeText }]}>
                {sourceLabel(item.source, sm)}
              </Text>
            </View>
            {item.managed ? (
              <View style={[styles.badge, { backgroundColor: badgeBg }]}>
                <Text style={[styles.badgeText, { color: badgeText }]}>
                  {sm.managed}
                </Text>
              </View>
            ) : null}
            <View style={[styles.badge, { backgroundColor: item.enabled ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)' }]}>
              <View style={[styles.statusDot, { backgroundColor: item.enabled ? enabledColor : disabledColor }]} />
              <Text style={[styles.badgeText, { color: item.enabled ? enabledColor : disabledColor }]}>
                {item.enabled ? sm.enabled : sm.disabled}
              </Text>
            </View>
          </View>
        </View>
      );
    },
    [cardBg, cardBorder, textPrimary, textSecondary, badgeBg, badgeText, enabledColor, disabledColor, sm],
  );

  if (!configured) {
    return (
      <View style={styles.center}>
        <Text style={{ opacity: 0.6 }}>{m.sessions.gatewayNotConfigured}</Text>
      </View>
    );
  }

  if (skillsQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (skillsQuery.isError) {
    return (
      <View style={styles.center}>
        <Text style={{ opacity: 0.6, marginBottom: 12 }}>{sm.loadFailed}</Text>
        <Button
          mode="outlined"
          onPress={() => void queryClient.invalidateQueries({ queryKey: queryKeys.skills })}
        >
          {m.common.retry}
        </Button>
      </View>
    );
  }

  if (catalog.length === 0) {
    return (
      <View style={styles.center}>
        <Icon source="puzzle-outline" size={48} color={textSecondary} />
        <Text style={[styles.emptyText, { color: textSecondary }]}>{sm.empty}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={catalog}
      keyExtractor={(item) => `${item.directoryId}-${item.path}`}
      renderItem={renderSkill}
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
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  cardTitleArea: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
  },
});
