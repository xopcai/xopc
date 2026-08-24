import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { t, useMessages } from '../../i18n/messages';
import { dismissOrHome } from '../../lib/navigation';
import { queryKeys } from '../../query/keys';
import { fetchProjects, type Project } from '../../query/projects';
import { useGatewayConfigured } from '../../query/sessions';
import { usePreferencesStore } from '../../stores/preferences-store';
import { spacing, typography, useTheme } from '../../theme';

import {
  formatProjectRelativeTime,
  projectPortfolioTotals,
  sortProjectPortfolio,
} from './project-presentation';

export function ProjectPortfolioScreen() {
  const router = useRouter();
  const configured = useGatewayConfigured();
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const language = usePreferencesStore((state) => state.language);
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const query = useQuery({ queryKey: queryKeys.projects, queryFn: fetchProjects, enabled: configured });
  const projects = useMemo(() => sortProjectPortfolio(query.data ?? []), [query.data]);
  const totals = useMemo(() => projectPortfolioTotals(projects), [projects]);

  const renderProject = useCallback(({ item }: { item: Project }) => {
    const counts = item.operating.counts;
    const status = counts.needsUser > 0
      ? t(labels.projectNeedsUserCount, { count: counts.needsUser })
      : counts.moving > 0
        ? t(labels.projectMovingCount, { count: counts.moving })
        : labels.projectIdle;
    const healthColor = item.operating.health === 'attention'
      ? colors.semantic.warning
      : item.operating.health === 'healthy'
        ? colors.semantic.success
        : colors.text.tertiary;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.name}
        onPress={() => router.push(`/projects/${item.id}`)}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.base, borderColor: colors.border.subtle }]}
      >
        <View style={[styles.healthDot, { backgroundColor: healthColor }]} />
        <View style={styles.rowBody}>
          <View style={styles.rowTitleLine}>
            <Text style={[styles.rowTitle, { color: colors.text.primary }]} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.time, { color: colors.text.tertiary }]}>{formatProjectRelativeTime(item.operating.updatedAt, locale)}</Text>
          </View>
          <Text style={[styles.status, { color: counts.needsUser > 0 ? colors.semantic.warning : colors.text.secondary }]}>{status}</Text>
          {item.operating.recommendedAction || item.description ? (
            <Text style={[styles.summary, { color: colors.text.secondary }]} numberOfLines={2}>
              {item.operating.recommendedAction || item.description}
            </Text>
          ) : null}
        </View>
        <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
      </Pressable>
    );
  }, [colors, labels, locale, router]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={labels.projectsTitle} onBack={() => dismissOrHome(router)} />
      {query.isLoading ? <View style={styles.skeleton}><ListSkeleton count={6} /></View> : query.isError ? (
        <View style={styles.center}>
          <Text style={{ color: colors.semantic.error }}>{labels.projectsLoadFailed}</Text>
          <Button onPress={() => void query.refetch()}>{labels.retry}</Button>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          renderItem={renderProject}
          ListHeaderComponent={projects.length ? (
            <View style={styles.briefing}>
              <Text style={[styles.briefingTitle, { color: colors.text.primary }]}>{labels.projectPortfolioBriefing}</Text>
              <Text style={[styles.briefingSummary, { color: colors.text.secondary }]}>
                {t(labels.projectPortfolioSummary, { needsUser: totals.needsUser, moving: totals.moving })}
              </Text>
            </View>
          ) : null}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}
          ListEmptyComponent={<Text style={{ color: colors.text.tertiary }}>{labels.projectsEmpty}</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  skeleton: { padding: spacing.lg },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  briefing: { paddingVertical: spacing.md, gap: spacing.xs },
  briefingTitle: { ...typography.heading },
  briefingSummary: { ...typography.body },
  row: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md },
  healthDot: { width: 8, height: 8, borderRadius: 4, alignSelf: 'flex-start', marginTop: 7 },
  rowBody: { flex: 1, minWidth: 0, gap: spacing.xxs },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { ...typography.ui, fontWeight: '600', flex: 1 },
  time: { ...typography.micro },
  status: { ...typography.label },
  summary: { ...typography.body },
});
