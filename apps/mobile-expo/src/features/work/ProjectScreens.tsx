import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { dismissOrHome } from '../../lib/navigation';
import { queryKeys } from '../../query/keys';
import { updateNote } from '../../query/notes';
import { fetchProjectOperatingView, fetchProjects } from '../../query/work-items';
import { confirmWorkIntake, proposeWorkIntake } from '../../query/work-intake';
import { useGatewayConfigured } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';

function firstParam(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? '' : value ?? ''; }

export function ProjectsScreen() {
  const router = useRouter();
  const configured = useGatewayConfigured();
  const { colors } = useTheme();
  const { workPage: labels } = useMessages();
  const query = useQuery({ queryKey: queryKeys.projects, queryFn: fetchProjects, enabled: configured });
  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={labels.projectsTitle} onBack={() => dismissOrHome(router)} />
      {query.isLoading ? <View style={styles.loading}><ActivityIndicator /></View> : <FlatList data={query.data ?? []} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={{ color: colors.text.tertiary }}>{labels.projectsEmpty}</Text>} renderItem={({ item }) => <Pressable onPress={() => router.push(`/projects/${item.id}`)} style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel, borderColor: colors.border.default }]}><Text style={[styles.cardTitle, { color: colors.text.primary }]}>{item.name}</Text>{item.description ? <Text numberOfLines={2} style={{ color: colors.text.secondary }}>{item.description}</Text> : null}</Pressable>} />}
    </View>
  );
}

export function ProjectDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const projectId = firstParam(id);
  const configured = useGatewayConfigured();
  const { colors } = useTheme();
  const { workPage: labels } = useMessages();
  const view = useQuery({ queryKey: queryKeys.projectOperatingView(projectId), queryFn: () => fetchProjectOperatingView(projectId), enabled: configured && !!projectId });
  if (view.isLoading || !view.data) return <View style={[styles.screen, styles.loading, { backgroundColor: colors.surface.base }]}><ActivityIndicator /></View>;
  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={view.data.project.name} onBack={() => dismissOrHome(router)} rightActions={[{ icon: 'plus', onPress: () => router.push(`/work/create?projectId=${projectId}`), accessibilityLabel: labels.create }]} />
      <ScrollView contentContainerStyle={styles.list}>
        <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}><Text style={[styles.cardTitle, { color: colors.text.primary }]}>{labels.projectPulse}</Text><Text style={{ color: colors.text.secondary }}>{view.data.digest.summary}</Text>{view.data.digest.recommendedAction ? <Text style={{ color: colors.accent.primary }}>{view.data.digest.recommendedAction}</Text> : null}</View>
        {view.data.desiredOutcomes.length ? <><Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.desiredOutcomes}</Text>{view.data.desiredOutcomes.map((goal) => <View key={goal.id} style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}><Text style={[styles.cardTitle, { color: colors.text.primary }]}>{goal.title}</Text><Text style={{ color: colors.accent.primary }}>{goal.status}</Text>{goal.nextAction ? <Text style={{ color: colors.text.secondary }}>{goal.nextAction}</Text> : null}</View>)}</> : null}
        <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.projectWork}</Text>
        {view.data.currentActions.map((item) => <Pressable key={item.id} onPress={() => router.push(`/work/${item.id}`)} style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}><Text style={[styles.cardTitle, { color: colors.text.primary }]}>{item.title}</Text><Text style={{ color: colors.accent.primary }}>{labels.status[item.status as keyof typeof labels.status] ?? item.status}</Text>{item.nextAction ? <Text style={{ color: colors.text.secondary }}>{item.nextAction}</Text> : null}</Pressable>)}
        {view.data.blockers.length ? <><Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.attention}</Text>{view.data.blockers.map((item) => <View key={item.id} style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}><Text style={[styles.cardTitle, { color: colors.text.primary }]}>{item.title}</Text>{item.detail ? <Text style={{ color: colors.text.secondary }}>{item.detail}</Text> : null}</View>)}</> : null}
        {view.data.recentReceipts.length ? <><Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.recentResults}</Text>{view.data.recentReceipts.slice(0, 5).map((receipt) => <View key={receipt.runId} style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}><Text style={[styles.cardTitle, { color: colors.text.primary }]}>{receipt.objective}</Text><Text style={{ color: colors.accent.primary }}>{receipt.status}</Text><Text style={{ color: colors.text.secondary }}>{receipt.summary}</Text></View>)}</> : null}
      </ScrollView>
    </View>
  );
}

export function CreateWorkItemScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string; title?: string; noteId?: string }>();
  const configured = useGatewayConfigured();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { workPage: labels } = useMessages();
  const projects = useQuery({ queryKey: queryKeys.projects, queryFn: fetchProjects, enabled: configured });
  const [title, setTitle] = useState(firstParam(params.title));
  const [projectId, setProjectId] = useState(firstParam(params.projectId));
  const [proposal, setProposal] = useState<Awaited<ReturnType<typeof proposeWorkIntake>> | null>(null);
  const prepare = useMutation({
    mutationFn: () => proposeWorkIntake({ objective: title.trim(), projectId: projectId || undefined }),
    onSuccess: setProposal,
  });
  const confirm = useMutation({
    mutationFn: () => confirmWorkIntake(proposal!.id),
    onSuccess: async (work) => {
      const noteId = firstParam(params.noteId);
      if (noteId) await updateNote(noteId, { status: 'processed' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workItems() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkItems(work.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      if (noteId) void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
      router.replace(`/projects/${work.projectId}`);
    },
  });
  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={labels.create} onBack={() => dismissOrHome(router)} />
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}>
        {!proposal ? <>
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.outcomeLabel}</Text>
          <TextInput multiline value={title} onChangeText={setTitle} placeholder={labels.outcomePlaceholder} placeholderTextColor={colors.text.tertiary} style={[styles.input, styles.intentInput, { color: colors.text.primary, borderColor: colors.border.default }]} />
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.projectLabel}</Text>
          <Pressable onPress={() => setProjectId('')} style={[styles.projectChoice, { borderColor: !projectId ? colors.accent.primary : colors.border.default, backgroundColor: colors.surface.panel }]}><Text style={{ color: colors.text.primary }}>{labels.letXopcChoose}</Text>{!projectId ? <Text style={{ color: colors.accent.primary }}>{labels.selected}</Text> : null}</Pressable>
          {(projects.data ?? []).map((project) => <Pressable key={project.id} onPress={() => setProjectId(project.id)} style={[styles.projectChoice, { borderColor: project.id === projectId ? colors.accent.primary : colors.border.default, backgroundColor: colors.surface.panel }]}><Text style={{ color: colors.text.primary }}>{project.name}</Text>{project.id === projectId ? <Text style={{ color: colors.accent.primary }}>{labels.selected}</Text> : null}</Pressable>)}
          <Pressable disabled={!title.trim() || prepare.isPending} onPress={() => prepare.mutate()} style={({ pressed }) => [styles.createButton, { backgroundColor: colors.accent.primary, opacity: pressed || prepare.isPending || !title.trim() ? 0.55 : 1 }]}><Text style={styles.createText}>{labels.preparePlan}</Text></Pressable>
          {prepare.error ? <Text style={{ color: colors.text.secondary }}>{prepare.error.message}</Text> : null}
        </> : <>
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.confirmPlan}</Text>
          <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
            <Text style={[styles.cardLabel, { color: colors.text.tertiary }]}>{labels.projectLabel}</Text>
            <Text style={[styles.cardTitle, { color: colors.text.primary }]}>{proposal.suggestedProject.name}</Text>
            <Text style={[styles.cardLabel, { color: colors.text.tertiary }]}>{labels.outcomeLabel}</Text>
            <Text style={{ color: colors.text.secondary }}>{proposal.suggestedProject.outcome}</Text>
            <Text style={[styles.cardLabel, { color: colors.text.tertiary }]}>{labels.firstAction}</Text>
            <Text style={{ color: colors.text.secondary }}>{proposal.suggestedProject.nextAction}</Text>
          </View>
          <Pressable disabled={confirm.isPending} onPress={() => confirm.mutate()} style={({ pressed }) => [styles.createButton, { backgroundColor: colors.accent.primary, opacity: pressed || confirm.isPending ? 0.55 : 1 }]}><Text style={styles.createText}>{labels.confirmAndCreate}</Text></Pressable>
          <Pressable disabled={confirm.isPending} onPress={() => setProposal(null)} style={styles.secondaryButton}><Text style={{ color: colors.text.secondary }}>{labels.editIntent}</Text></Pressable>
          {confirm.error ? <Text style={{ color: colors.text.secondary }}>{confirm.error.message}</Text> : null}
        </>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, loading: { alignItems: 'center', justifyContent: 'center' }, list: { padding: spacing.md, gap: spacing.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs }, cardTitle: { ...typography.body, fontWeight: '700' }, sectionTitle: { ...typography.body, fontWeight: '700', marginTop: spacing.sm },
  input: { ...typography.body, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md }, intentInput: { minHeight: 120, textAlignVertical: 'top' }, projectChoice: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  createButton: { borderRadius: radii.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.md }, createText: { color: '#fff', fontWeight: '700' },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, cardLabel: { ...typography.caption, marginTop: spacing.xs },
});
