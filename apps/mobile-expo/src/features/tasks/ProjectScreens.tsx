import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { t, useMessages } from '../../i18n/messages';
import { dismissOrHome } from '../../lib/navigation';
import { fetchChatAgents } from '../../query/agents';
import { queryKeys } from '../../query/keys';
import { updateNote } from '../../query/notes';
import { fetchProjectOperatingView, fetchProjects } from '../../query/projects';
import { useGatewayConfigured } from '../../query/sessions';
import { createTask } from '../../query/tasks';
import { radii, spacing, typography, useTheme } from '../../theme';

import { buildMobileTaskCreateRequest } from './task-create-input';

type Picker = 'project' | 'agent' | 'dependencies' | null;

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

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
  const [showMore, setShowMore] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);

  const selectedProject = projects.data?.find((item) => item.id === projectId);
  const selectedAgent = agents.data?.items.find((item) => item.id === selectedAgentId);
  const automaticAgent = agents.data?.items.find((item) => (
    item.id === selectedProject?.defaultAgentId
  )) ?? agents.data?.items.find((item) => item.id === agents.data?.defaultId);
  const agentValue = selectedAgent?.name ?? selectedAgent?.id
    ?? automaticAgent?.name ?? automaticAgent?.id
    ?? labels.automaticAgent;
  const projectValue = selectedProject?.name
    ?? (projectId ? labels.selectionUnavailable : labels.noProject);

  const projectTasks = useQuery({
    queryKey: queryKeys.projectOperatingView(projectId),
    queryFn: () => fetchProjectOperatingView(projectId),
    enabled: configured && Boolean(projectId) && picker === 'dependencies',
  });
  const openProjectTasks = useMemo(
    () => (projectTasks.data?.tasks ?? []).filter((task) => task.phase !== 'closed'),
    [projectTasks.data?.tasks],
  );

  const markChanged = () => setRequestId(randomUUID());
  const create = useMutation({
    mutationFn: () => {
      return createTask(buildMobileTaskCreateRequest({
        idempotencyKey: requestId,
        title,
        projectId,
        dependencies: dependsOnTaskIds,
        agentId: selectedAgentId || undefined,
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

  const projectSelectionReady = !projectId || Boolean(selectedProject);
  const selectedAgentUnavailable = Boolean(selectedAgentId)
    && !agents.isLoading
    && (agents.isError || !selectedAgent);
  const canCreate = Boolean(title.trim())
    && projectSelectionReady
    && !create.isPending
    && !selectedAgentUnavailable;
  const setupError = selectedAgentUnavailable
    ? labels.agentUnavailable
    : projectId && projects.isError
      ? labels.projectsLoadFailed
      : projectId && !projects.isLoading && !selectedProject
        ? labels.selectionUnavailable
        : undefined;

  const selectProject = (nextProjectId: string) => {
    setProjectId(nextProjectId);
    setDependsOnTaskIds([]);
    markChanged();
    setPicker(null);
  };

  const selectAgent = (nextAgentId: string) => {
    setSelectedAgentId(nextAgentId);
    markChanged();
    setPicker(null);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.surface.base }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <NativeScreenHeader title={labels.create} onBack={() => dismissOrHome(router)} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text style={[styles.introTitle, { color: colors.text.primary }]}>{labels.createHeading}</Text>
          <Text style={[styles.introBody, { color: colors.text.secondary }]}>{labels.createHint}</Text>
        </View>

        <FormSection title={labels.taskEssentials}>
          <FieldLabel>{labels.titleLabel}</FieldLabel>
          <TextInput
            autoFocus={!title}
            value={title}
            onChangeText={(value) => { setTitle(value); markChanged(); }}
            placeholder={labels.titlePlaceholder}
            placeholderTextColor={colors.text.tertiary}
            style={[styles.input, { color: colors.text.primary, backgroundColor: colors.surface.input, borderColor: colors.border.default }]}
            returnKeyType="next"
          />
          <FieldLabel optional>{labels.taskLabel}</FieldLabel>
          <TextInput
            multiline
            value={body}
            onChangeText={(value) => { setBody(value); markChanged(); }}
            placeholder={labels.taskPlaceholder}
            placeholderTextColor={colors.text.tertiary}
            style={[styles.input, styles.intentInput, { color: colors.text.primary, backgroundColor: colors.surface.input, borderColor: colors.border.default }]}
          />
        </FormSection>

        <FormSection title={labels.taskSetup}>
          <View style={[styles.settingGroup, { backgroundColor: colors.surface.panel }]}>
            <SettingRow
              icon="folder-outline"
              label={labels.projectLabel}
              value={projectValue}
              onPress={() => setPicker('project')}
              loading={projects.isLoading}
            />
            <View style={[styles.divider, { backgroundColor: colors.border.subtle }]} />
            <SettingRow
              icon="account-outline"
              label={labels.agentLabel}
              value={agentValue}
              hint={selectedAgentId ? undefined : labels.automaticAgentHint}
              onPress={() => setPicker('agent')}
              loading={agents.isLoading}
            />
          </View>
        </FormSection>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showMore }}
          onPress={() => setShowMore((current) => !current)}
          style={({ pressed }) => [styles.moreButton, pressed && { backgroundColor: colors.surface.pressed }]}
        >
          <View style={styles.moreText}>
            <Text style={[styles.moreTitle, { color: colors.text.primary }]}>{labels.moreOptions}</Text>
            <Text style={[styles.moreHint, { color: colors.text.tertiary }]}>{labels.moreOptionsHint}</Text>
          </View>
          <Icon source={showMore ? 'chevron-up' : 'chevron-down'} size={20} color={colors.text.tertiary} />
        </Pressable>

        {showMore ? (
          <FormSection>
            <FieldLabel optional>{labels.completionCriteria}</FieldLabel>
            <TextInput
              multiline
              value={completionCriteria}
              onChangeText={(value) => { setCompletionCriteria(value); markChanged(); }}
              placeholder={labels.completionCriteriaPlaceholder}
              placeholderTextColor={colors.text.tertiary}
              style={[styles.input, styles.criteriaInput, { color: colors.text.primary, backgroundColor: colors.surface.input, borderColor: colors.border.default }]}
            />
            {projectId ? (
              <View style={[styles.settingGroup, { backgroundColor: colors.surface.panel }]}>
                <SettingRow
                  icon="source-branch"
                  label={labels.dependencies}
                  value={dependsOnTaskIds.length
                    ? t(labels.dependenciesSelected, { count: dependsOnTaskIds.length })
                    : labels.dependenciesNone}
                  hint={labels.dependenciesDescription}
                  onPress={() => setPicker('dependencies')}
                />
              </View>
            ) : (
              <Text style={[styles.dependenciesHint, { color: colors.text.tertiary }]}>{labels.dependenciesRequireProject}</Text>
            )}
          </FormSection>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.surface.base, borderTopColor: colors.border.subtle, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {create.error || setupError ? (
          <Text style={[styles.error, { color: colors.semantic.error }]}>{create.error?.message ?? setupError}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={!canCreate}
          onPress={() => create.mutate()}
          style={({ pressed }) => [styles.createButton, {
            backgroundColor: colors.accent.primary,
            opacity: pressed || !canCreate ? 0.55 : 1,
          }]}
        >
          <Text style={[styles.createText, { color: colors.accent.onPrimary }]}>
            {create.isPending ? labels.creating : labels.confirmAndCreate}
          </Text>
        </Pressable>
      </View>

      <BottomSheetModal
        visible={picker === 'project'}
        onDismiss={() => setPicker(null)}
        title={labels.projectPickerTitle}
        subtitle={labels.projectPickerHint}
        maxHeight="70%"
        scroll
      >
        <ChoiceRow
          label={labels.noProject}
          description={labels.noProjectHint}
          selected={!projectId}
          onPress={() => selectProject('')}
        />
        {projects.isLoading ? <View style={styles.sheetState}><ListSkeleton count={3} /></View> : projects.isError ? (
          <LoadError label={labels.projectsLoadFailed} retryLabel={labels.retry} onRetry={() => void projects.refetch()} />
        ) : (projects.data ?? []).map((project) => (
          <ChoiceRow
            key={project.id}
            label={project.name}
            selected={project.id === projectId}
            onPress={() => selectProject(project.id)}
          />
        ))}
      </BottomSheetModal>

      <BottomSheetModal
        visible={picker === 'agent'}
        onDismiss={() => setPicker(null)}
        title={labels.agentPickerTitle}
        subtitle={labels.agentPickerHint}
        maxHeight="70%"
        scroll
      >
        <ChoiceRow
          label={labels.automaticAgent}
          description={automaticAgent?.name ?? automaticAgent?.id ?? labels.automaticAgentHint}
          selected={!selectedAgentId}
          onPress={() => selectAgent('')}
        />
        {agents.isLoading ? <View style={styles.sheetState}><ListSkeleton count={3} /></View> : agents.isError ? (
          <LoadError label={labels.agentUnavailable} retryLabel={labels.retry} onRetry={() => void agents.refetch()} />
        ) : (agents.data?.items ?? []).map((agent) => (
          <ChoiceRow
            key={agent.id}
            label={agent.name ?? agent.id}
            description={agent.description}
            selected={agent.id === selectedAgentId}
            onPress={() => selectAgent(agent.id)}
          />
        ))}
      </BottomSheetModal>

      <BottomSheetModal
        visible={picker === 'dependencies'}
        onDismiss={() => setPicker(null)}
        title={labels.dependenciesPickerTitle}
        subtitle={labels.dependenciesDescription}
        maxHeight="72%"
        scroll
        footer={<Button mode="contained" onPress={() => setPicker(null)}>{labels.done}</Button>}
      >
        {projectTasks.isLoading ? <View style={styles.sheetState}><ListSkeleton count={4} /></View> : projectTasks.isError ? (
          <LoadError label={labels.projectLoadFailed} retryLabel={labels.retry} onRetry={() => void projectTasks.refetch()} />
        ) : openProjectTasks.length ? openProjectTasks.map((task) => {
          const selected = dependsOnTaskIds.includes(task.id);
          return (
            <ChoiceRow
              key={task.id}
              label={task.title}
              selected={selected}
              multiple
              onPress={() => {
                setDependsOnTaskIds((current) => selected
                  ? current.filter((id) => id !== task.id)
                  : [...current, task.id]);
                markChanged();
              }}
            />
          );
        }) : <Text style={[styles.emptySheet, { color: colors.text.secondary }]}>{labels.dependenciesEmpty}</Text>}
      </BottomSheetModal>
    </KeyboardAvoidingView>
  );
}

function FormSection({ title, children }: { title?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      {title ? <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{title}</Text> : null}
      {children}
    </View>
  );
}

function FieldLabel({ optional, children }: { optional?: boolean; children: ReactNode }) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  return (
    <View style={styles.fieldLabelRow}>
      <Text style={[styles.fieldLabel, { color: colors.text.primary }]}>{children}</Text>
      {optional ? <Text style={[styles.optional, { color: colors.text.tertiary }]}>{labels.optional}</Text> : null}
    </View>
  );
}

function SettingRow({
  icon,
  label,
  value,
  hint,
  loading,
  onPress,
}: {
  icon: string;
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.settingRow, pressed && { backgroundColor: colors.surface.pressed }]}>
      <Icon source={icon} size={21} color={colors.text.secondary} />
      <View style={styles.settingBody}>
        <Text style={[styles.settingLabel, { color: colors.text.primary }]}>{label}</Text>
        {loading ? (
          <Text style={[styles.settingValue, { color: colors.text.tertiary }]}>…</Text>
        ) : (
          <Text numberOfLines={1} style={[styles.settingValue, { color: colors.text.secondary }]}>{value}</Text>
        )}
        {hint ? <Text numberOfLines={2} style={[styles.settingHint, { color: colors.text.tertiary }]}>{hint}</Text> : null}
      </View>
      <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
    </Pressable>
  );
}

function ChoiceRow({
  label,
  description,
  selected,
  multiple,
  onPress,
}: {
  label: string;
  description?: string;
  selected: boolean;
  multiple?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.choiceRow, {
        backgroundColor: selected ? colors.accent.selectionBg : pressed ? colors.surface.pressed : 'transparent',
      }]}
    >
      <View style={styles.choiceBody}>
        <Text numberOfLines={2} style={[styles.choiceLabel, { color: selected ? colors.accent.primary : colors.text.primary }]}>{label}</Text>
        {description ? <Text numberOfLines={2} style={[styles.choiceDescription, { color: colors.text.tertiary }]}>{description}</Text> : null}
      </View>
      {selected || multiple ? (
        <Icon
          source={selected ? (multiple ? 'checkbox-marked' : 'check') : 'checkbox-blank-outline'}
          size={20}
          color={selected ? colors.accent.primary : colors.text.tertiary}
        />
      ) : null}
    </Pressable>
  );
}

function LoadError({ label, retryLabel, onRetry }: { label: string; retryLabel: string; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.loadError}>
      <Text style={[styles.error, { color: colors.semantic.error }]}>{label}</Text>
      <Button onPress={onRetry}>{retryLabel}</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.content, paddingTop: spacing.lg, paddingBottom: spacing.section, gap: spacing.section },
  intro: { gap: spacing.xs },
  introTitle: { ...typography.title },
  introBody: { ...typography.body },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.heading, marginBottom: spacing.xs },
  fieldLabelRow: { minHeight: 22, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fieldLabel: { ...typography.label, fontWeight: '600' },
  optional: { ...typography.caption },
  input: { ...typography.body, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  intentInput: { minHeight: 104, textAlignVertical: 'top' },
  criteriaInput: { minHeight: 88, textAlignVertical: 'top' },
  settingGroup: { borderRadius: radii.lg, overflow: 'hidden' },
  settingRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  settingBody: { flex: 1, minWidth: 0, gap: spacing.xxs },
  settingLabel: { ...typography.ui, fontWeight: '600' },
  settingValue: { ...typography.label },
  settingHint: { ...typography.caption },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 52 },
  moreButton: { minHeight: 60, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm },
  moreText: { flex: 1, gap: spacing.xxs },
  moreTitle: { ...typography.ui, fontWeight: '600' },
  moreHint: { ...typography.caption },
  dependenciesHint: { ...typography.caption, paddingHorizontal: spacing.xs },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.content, paddingTop: spacing.md },
  createButton: { minHeight: 50, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  createText: { ...typography.ui, fontWeight: '700' },
  error: { ...typography.caption },
  choiceRow: { minHeight: 56, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  choiceBody: { flex: 1, minWidth: 0, gap: spacing.xxs },
  choiceLabel: { ...typography.ui, fontWeight: '500' },
  choiceDescription: { ...typography.caption },
  sheetState: { paddingVertical: spacing.sm },
  loadError: { alignItems: 'flex-start', gap: spacing.xs, padding: spacing.md },
  emptySheet: { ...typography.body, textAlign: 'center', padding: spacing.xl },
});
