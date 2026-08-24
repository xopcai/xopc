import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { dismissOrHome } from '../../lib/navigation';
import { fetchChatAgents } from '../../query/agents';
import { queryKeys } from '../../query/keys';
import { updateNote } from '../../query/notes';
import { fetchProjectOperatingView, fetchProjects } from '../../query/projects';
import { createTask } from '../../query/tasks';
import { useGatewayConfigured } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';
import { buildMobileTaskCreateRequest, resolveTaskAgentId } from './task-create-input';

function firstParam(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? '' : value ?? ''; }

export function CreateTaskScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string; title?: string; noteId?: string }>();
  const configured = useGatewayConfigured();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { tasksPage: labels } = useMessages();
  const projects = useQuery({ queryKey: queryKeys.projects, queryFn: fetchProjects, enabled: configured });
  const agents = useQuery({ queryKey: queryKeys.agents, queryFn: fetchChatAgents, enabled: configured });
  const [title, setTitle] = useState(firstParam(params.title));
  const [body, setBody] = useState('');
  const [completionCriteria, setCompletionCriteria] = useState('');
  const [projectId, setProjectId] = useState(firstParam(params.projectId));
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [requestId, setRequestId] = useState(() => randomUUID());
  const [dependsOnTaskIds, setDependsOnTaskIds] = useState<string[]>([]);
  const projectTasks = useQuery({
    queryKey: queryKeys.projectOperatingView(projectId),
    queryFn: () => fetchProjectOperatingView(projectId),
    enabled: configured && Boolean(projectId),
  });
  const create = useMutation({
    mutationFn: () => {
      if (!agents.data) throw new Error(labels.agentUnavailable);
      const project = projects.data?.find((item) => item.id === projectId);
      const agentId = resolveTaskAgentId({ agents: agents.data, project, selectedAgentId });
      return createTask(buildMobileTaskCreateRequest({
        idempotencyKey: requestId,
        title,
        projectId,
        dependencies: dependsOnTaskIds,
        agentId,
        noteId: firstParam(params.noteId),
        body,
        acceptanceCriteria: completionCriteria.split('\n'),
      }));
    },
    onSuccess: async (created) => {
      const noteId = firstParam(params.noteId);
      if (noteId) await updateNote(noteId, { status: 'processed' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      if (projectId) void queryClient.invalidateQueries({ queryKey: queryKeys.projectOperatingView(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      if (noteId) void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
      router.replace(`/tasks/${created.task.id}`);
    },
  });
  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={labels.create} onBack={() => dismissOrHome(router)} />
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}>
        <>
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.titleLabel}</Text>
          <TextInput value={title} onChangeText={(value) => { setTitle(value); setRequestId(randomUUID()); }} placeholder={labels.titlePlaceholder} placeholderTextColor={colors.text.tertiary} style={[styles.input, { color: colors.text.primary, borderColor: colors.border.default }]} />
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.taskLabel}</Text>
          <TextInput multiline value={body} onChangeText={(value) => { setBody(value); setRequestId(randomUUID()); }} placeholder={labels.taskPlaceholder} placeholderTextColor={colors.text.tertiary} style={[styles.input, styles.intentInput, { color: colors.text.primary, borderColor: colors.border.default }]} />
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.completionCriteria}</Text>
          <TextInput multiline value={completionCriteria} onChangeText={(value) => { setCompletionCriteria(value); setRequestId(randomUUID()); }} placeholder={labels.completionCriteriaPlaceholder} placeholderTextColor={colors.text.tertiary} style={[styles.input, styles.criteriaInput, { color: colors.text.primary, borderColor: colors.border.default }]} />
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.projectLabel}</Text>
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: !projectId }} onPress={() => { setProjectId(''); setDependsOnTaskIds([]); setRequestId(randomUUID()); }} style={[styles.projectChoice, { borderColor: !projectId ? colors.accent.primary : colors.border.default, backgroundColor: colors.surface.panel }]}><Text style={{ color: colors.text.primary }}>{labels.letXopcChoose}</Text>{!projectId ? <Text style={{ color: colors.accent.primary }}>{labels.selected}</Text> : null}</Pressable>
          {projects.isLoading ? <ListSkeleton count={2} /> : projects.isError ? (
            <View style={styles.inlineState}>
              <Text style={{ color: colors.semantic.error }}>{labels.projectsLoadFailed}</Text>
              <Button onPress={() => void projects.refetch()}>{labels.retry}</Button>
            </View>
          ) : (projects.data ?? []).map((project) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: project.id === projectId }} key={project.id} onPress={() => { setProjectId(project.id); setDependsOnTaskIds([]); setRequestId(randomUUID()); }} style={[styles.projectChoice, { borderColor: project.id === projectId ? colors.accent.primary : colors.border.default, backgroundColor: colors.surface.panel }]}><Text style={{ color: colors.text.primary }}>{project.name}</Text>{project.id === projectId ? <Text style={{ color: colors.accent.primary }}>{labels.selected}</Text> : null}</Pressable>)}
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.agentLabel}</Text>
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: !selectedAgentId }} onPress={() => { setSelectedAgentId(''); setRequestId(randomUUID()); }} style={[styles.projectChoice, { borderColor: !selectedAgentId ? colors.accent.primary : colors.border.default, backgroundColor: colors.surface.panel }]}><Text style={{ color: colors.text.primary }}>{labels.automaticAgent}</Text>{!selectedAgentId ? <Text style={{ color: colors.accent.primary }}>{labels.selected}</Text> : null}</Pressable>
          {agents.isLoading ? <ListSkeleton count={2} /> : agents.isError ? (
            <View style={styles.inlineState}>
              <Text style={{ color: colors.semantic.error }}>{labels.agentUnavailable}</Text>
              <Button onPress={() => void agents.refetch()}>{labels.retry}</Button>
            </View>
          ) : (agents.data?.items ?? []).map((agent) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: agent.id === selectedAgentId }} key={agent.id} onPress={() => { setSelectedAgentId(agent.id); setRequestId(randomUUID()); }} style={[styles.projectChoice, { borderColor: agent.id === selectedAgentId ? colors.accent.primary : colors.border.default, backgroundColor: colors.surface.panel }]}><Text style={{ color: colors.text.primary }}>{agent.name ?? agent.id}</Text>{agent.id === selectedAgentId ? <Text style={{ color: colors.accent.primary }}>{labels.selected}</Text> : null}</Pressable>)}
          {projectId ? (
            <>
              <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.dependencies}</Text>
              <Text style={[styles.help, { color: colors.text.secondary }]}>{labels.dependenciesDescription}</Text>
              {projectTasks.isLoading ? <ListSkeleton count={2} /> : projectTasks.isError ? (
                <View style={styles.inlineState}>
                  <Text style={{ color: colors.semantic.error }}>{labels.projectLoadFailed}</Text>
                  <Button onPress={() => void projectTasks.refetch()}>{labels.retry}</Button>
                </View>
              ) : (projectTasks.data?.tasks ?? []).filter((task) => task.phase !== 'closed').map((task) => {
                const selected = dependsOnTaskIds.includes(task.id);
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    key={task.id}
                    onPress={() => { setDependsOnTaskIds((current) => selected ? current.filter((id) => id !== task.id) : [...current, task.id]); setRequestId(randomUUID()); }}
                    style={[styles.projectChoice, { borderColor: selected ? colors.accent.primary : colors.border.default, backgroundColor: colors.surface.panel }]}
                  >
                    <Text numberOfLines={2} style={[styles.dependencyTitle, { color: colors.text.primary }]}>{task.title}</Text>
                    {selected ? <Text style={{ color: colors.accent.primary }}>{labels.selected}</Text> : null}
                  </Pressable>
                );
              })}
            </>
          ) : null}
          <Pressable accessibilityRole="button" disabled={!title.trim() || create.isPending || agents.isLoading || agents.isError} onPress={() => create.mutate()} style={({ pressed }) => [styles.createButton, { backgroundColor: colors.accent.primary, opacity: pressed || create.isPending || !title.trim() || agents.isLoading || agents.isError ? 0.55 : 1 }]}><Text style={styles.createText}>{labels.confirmAndCreate}</Text></Pressable>
          {create.error ? <Text style={{ color: colors.text.secondary }}>{create.error.message}</Text> : null}
        </>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, loading: { alignItems: 'center', justifyContent: 'center' }, list: { padding: spacing.md, gap: spacing.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs }, cardTitle: { ...typography.body, fontWeight: '700' }, sectionTitle: { ...typography.body, fontWeight: '700', marginTop: spacing.sm },
  input: { ...typography.body, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md }, intentInput: { minHeight: 112, textAlignVertical: 'top' }, criteriaInput: { minHeight: 88, textAlignVertical: 'top' }, projectChoice: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  createButton: { borderRadius: radii.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.md }, createText: { color: '#fff', fontWeight: '700' },
  help: { ...typography.caption }, dependencyTitle: { ...typography.body, flex: 1 },
  inlineState: { alignItems: 'flex-start', gap: spacing.xs },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, cardLabel: { ...typography.caption, marginTop: spacing.xs },
});
