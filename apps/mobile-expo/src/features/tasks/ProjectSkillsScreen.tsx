import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { dismissOrHome } from '../../lib/navigation';
import { queryKeys } from '../../query/keys';
import { fetchProjectSkills, type ProjectSkill, type ProjectSkillSource } from '../../query/projects';
import { useGatewayConfigured } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export function ProjectSkillsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const projectId = firstParam(id);
  const configured = useGatewayConfigured();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const skills = useQuery({
    queryKey: queryKeys.projectSkills(projectId),
    queryFn: () => fetchProjectSkills(projectId),
    enabled: configured && Boolean(projectId),
  });

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={labels.projectSkillsTitle} onBack={() => dismissOrHome(router)} />
      {skills.isLoading ? <View style={styles.skeleton}><ListSkeleton count={6} /></View> : skills.isError || !skills.data ? (
        <View style={styles.center}>
          <Icon source="alert-circle-outline" size={32} color={colors.semantic.error} />
          <Text style={[styles.body, { color: colors.semantic.error }]}>{labels.projectSkillsLoadFailed}</Text>
          <Button onPress={() => void skills.refetch()}>{labels.retry}</Button>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={skills.isFetching} onRefresh={() => void skills.refetch()} />}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.intro}>
            <Text style={[styles.title, { color: colors.text.primary }]}>{labels.projectSkillsTitle}</Text>
            <Text style={[styles.body, { color: colors.text.secondary }]}>{labels.projectSkillsHint}</Text>
          </View>
          <SkillSources sources={skills.data.sources} />
          {skills.data.diagnostics.some((diagnostic) => diagnostic.type !== 'skipped') ? (
            <View style={[styles.section, { backgroundColor: colors.surface.panel, borderColor: colors.semantic.warning }]}>
              <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.projectSkillsDiagnostics}</Text>
              {skills.data.diagnostics.filter((diagnostic) => diagnostic.type !== 'skipped').map((diagnostic, index) => (
                <View key={`${diagnostic.type}:${diagnostic.path ?? ''}:${index}`} style={styles.diagnosticRow}>
                  <Icon source="alert-outline" size={18} color={colors.semantic.warning} />
                  <Text style={[styles.body, styles.flexText, { color: colors.text.secondary }]}>{diagnostic.message}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <SkillSection title={labels.projectSkillsLocal} items={skills.data.items} />
          <SkillSection title={labels.projectSkillsInherited} items={skills.data.inheritedItems} />
        </ScrollView>
      )}
    </View>
  );
}

function SkillSources({ sources }: { sources: ProjectSkillSource[] }) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  return (
    <View style={[styles.section, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
      <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.projectSkillsSources}</Text>
      {sources.map((source) => (
        <View key={source.origin} style={styles.sourceRow}>
          <View style={styles.flexText}>
            <Text style={[styles.skillName, { color: colors.text.primary }]}>
              {source.origin === 'xopc-workspace' ? labels.projectSkillsSourceXopc : labels.projectSkillsSourceAgents}
            </Text>
            <Text style={[styles.path, { color: colors.text.tertiary }]} numberOfLines={2}>{source.rootDir}</Text>
          </View>
          <Text style={[styles.badge, { color: source.state === 'active' ? colors.semantic.success : colors.semantic.warning, backgroundColor: colors.surface.grouped }]}>
            {labels.projectSkillsSourceStates[source.state]}
          </Text>
        </View>
      ))}
    </View>
  );
}

function SkillSection({ title, items }: { title: string; items: ProjectSkill[] }) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  return (
    <View style={[styles.section, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
      <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{title} · {items.length}</Text>
      {items.length ? items.map((skill) => (
        <View key={skill.key} style={styles.skillRow}>
          <View style={[styles.skillIcon, { backgroundColor: colors.surface.grouped }]}>
            <Icon source="creation-outline" size={20} color={skill.effective ? colors.accent.primary : colors.text.tertiary} />
          </View>
          <View style={styles.flexText}>
            <Text style={[styles.skillName, { color: colors.text.primary }]} numberOfLines={1}>{skill.name}</Text>
            {skill.description ? <Text style={[styles.body, { color: colors.text.secondary }]} numberOfLines={3}>{skill.description}</Text> : null}
            <Text style={[styles.path, { color: colors.text.tertiary }]} numberOfLines={2}>{skill.path}</Text>
          </View>
          <Text style={[styles.badge, { color: skill.effective ? colors.semantic.success : colors.text.tertiary, backgroundColor: colors.surface.grouped }]}>
            {skill.shadowedBy ? labels.projectSkillsShadowed : skill.effective ? labels.projectSkillsAvailable : labels.projectSkillsUnavailable}
          </Text>
        </View>
      )) : <Text style={[styles.empty, { color: colors.text.tertiary }]}>{labels.projectSkillsEmptySection}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  skeleton: { padding: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  content: { padding: spacing.lg, gap: spacing.md },
  intro: { gap: spacing.xs },
  title: { ...typography.heading },
  body: { ...typography.body },
  section: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, gap: spacing.md },
  sectionTitle: { ...typography.heading },
  sourceRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  diagnosticRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  skillRow: { minHeight: 72, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  skillIcon: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  skillName: { ...typography.ui, fontWeight: '600' },
  path: { ...typography.caption },
  badge: { ...typography.caption, flexShrink: 1, overflow: 'hidden', borderRadius: radii.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  flexText: { flex: 1, minWidth: 0, gap: spacing.xxs },
  empty: { ...typography.body, paddingVertical: spacing.lg, textAlign: 'center' },
});
