import type { Automation, ProjectTaskCard, TaskRunReceipt } from '@xopcai/gateway-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { t, useMessages } from '../../i18n/messages';
import { dismissOrHome, openChat, openNoteDetail } from '../../lib/navigation';
import { fetchAutomations, runAutomationNow, setAutomationEnabled } from '../../query/automations';
import { queryKeys } from '../../query/keys';
import { captureNote, fetchNotes } from '../../query/notes';
import {
  fetchProject,
  fetchProjectActivity,
  fetchProjectFiles,
  fetchProjectOperatingView,
  fetchProjectSessions,
  pinProject,
  unpinProject,
  updateProjectStatus,
  type ProjectActivityEvent,
  type ProjectFileEntry,
  type ProjectSession,
} from '../../query/projects';
import { createProjectSession, useGatewayConfigured } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';
import { resolveNoteListTitle } from '../notes/note-title';

import { groupProjectTasks } from './project-presentation';

type ProjectSection = 'overview' | 'work' | 'context';

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function sessionTitle(session: ProjectSession, fallback: string): string {
  return session.name?.trim() || session.title?.trim() || session.displayName?.trim() || fallback;
}

function fileIcon(entry: ProjectFileEntry): string {
  if (entry.type === 'directory') return 'folder-outline';
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(entry.name)) return 'image-outline';
  if (/\.(md|txt|json|tsx?|jsx?|css|html?|ya?ml)$/i.test(entry.name)) return 'file-code-outline';
  return 'file-outline';
}

export function ProjectOperatingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const projectId = firstParam(id);
  const configured = useGatewayConfigured();
  const { colors } = useTheme();
  const messages = useMessages();
  const labels = messages.tasksPage;
  const [section, setSection] = useState<ProjectSection>('overview');
  const [createMenuVisible, setCreateMenuVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);

  const view = useQuery({
    queryKey: queryKeys.projectOperatingView(projectId),
    queryFn: () => fetchProjectOperatingView(projectId),
    enabled: configured && Boolean(projectId),
  });
  const sessions = useQuery({
    queryKey: queryKeys.projectSessions(projectId),
    queryFn: () => fetchProjectSessions(projectId),
    enabled: configured && Boolean(projectId) && section === 'work',
  });
  const notes = useQuery({
    queryKey: queryKeys.projectNotes(projectId),
    queryFn: () => fetchNotes({ projectId, limit: 8, sortBy: 'updatedAt', sortOrder: 'desc' }),
    enabled: configured && Boolean(projectId) && section === 'context',
  });
  const files = useQuery({
    queryKey: queryKeys.projectFiles(projectId),
    queryFn: () => fetchProjectFiles(projectId),
    enabled: configured && Boolean(projectId) && section === 'context',
  });
  const activity = useQuery({
    queryKey: queryKeys.projectActivity(projectId),
    queryFn: () => fetchProjectActivity(projectId),
    enabled: configured && Boolean(projectId) && section === 'overview',
  });
  const automations = useQuery({
    queryKey: queryKeys.projectAutomations(projectId),
    queryFn: () => fetchAutomations(projectId),
    enabled: configured && Boolean(projectId) && section === 'overview',
  });
  const details = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => fetchProject(projectId),
    enabled: configured && Boolean(projectId),
  });
  const createChat = useMutation({
    mutationFn: () => createProjectSession(projectId),
    onSuccess: (sessionKey) => {
      setCreateMenuVisible(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectSessions(projectId) });
      openChat(router, sessionKey);
    },
  });
  const createNote = useMutation({
    mutationFn: () => captureNote({ projectId, kind: 'thought' }),
    onSuccess: ({ note }) => {
      setCreateMenuVisible(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectNotes(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notesAll });
      openNoteDetail(router, note.id);
    },
  });
  const toggleAutomation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setAutomationEnabled(id, enabled),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.projectAutomations(projectId) }),
  });
  const runAutomation = useMutation({
    mutationFn: (id: string) => runAutomationNow(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.projectAutomations(projectId) }),
  });
  const changePinned = useMutation({
    mutationFn: (pinned: boolean) => pinned ? unpinProject(projectId) : pinProject(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
  const changeArchived = useMutation({
    mutationFn: (archived: boolean) => updateProjectStatus(projectId, archived ? 'active' : 'archived'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectOperatingView(projectId) });
    },
  });
  const refreshing = view.isFetching || sessions.isFetching || notes.isFetching || files.isFetching || activity.isFetching || automations.isFetching;
  const refresh = () => {
    void view.refetch();
    if (section === 'work') void sessions.refetch();
    if (section === 'context') { void notes.refetch(); void files.refetch(); }
    if (section === 'overview') { void activity.refetch(); void automations.refetch(); }
  };

  if (view.isLoading) return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={labels.projectsTitle} onBack={() => dismissOrHome(router)} />
      <View style={styles.skeleton}><ListSkeleton count={5} /></View>
    </View>
  );
  if (view.isError || !view.data) return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={labels.projectsTitle} onBack={() => dismissOrHome(router)} />
      <View style={styles.center}>
        <Text style={{ color: colors.semantic.error }}>{labels.projectLoadFailed}</Text>
        <Button onPress={() => void view.refetch()}>{labels.retry}</Button>
      </View>
    </View>
  );

  const data = view.data;
  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader
        title={data.project.name}
        onBack={() => dismissOrHome(router)}
        rightActions={[
          { icon: 'cog-outline', onPress: () => setSettingsVisible(true), accessibilityLabel: labels.projectSettings },
          { icon: 'plus', onPress: () => setCreateMenuVisible(true), accessibilityLabel: labels.projectCreateTitle },
        ]}
      />
      <ProjectSectionTabs value={section} onChange={setSection} />
      {createChat.error || createNote.error || toggleAutomation.error || runAutomation.error ? (
        <Text style={[styles.inlineError, { color: colors.semantic.error }]}>
          {(createChat.error ?? createNote.error ?? toggleAutomation.error ?? runAutomation.error)?.message}
        </Text>
      ) : null}
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {section === 'overview' ? (
          <ProjectOverview
            tasks={data.tasks}
            receipts={data.recentResults}
            health={data.digest.health}
            recommendation={data.digest.recommendedAction}
            activity={activity.data ?? []}
            activityLoading={activity.isLoading}
            activityError={activity.isError}
            automations={automations.data ?? []}
            automationsLoading={automations.isLoading}
            automationsError={automations.isError}
            automationPendingId={toggleAutomation.isPending
              ? toggleAutomation.variables?.id
              : runAutomation.isPending ? runAutomation.variables : undefined}
            onToggleAutomation={(automation) => toggleAutomation.mutate({ id: automation.id, enabled: !automation.enabled })}
            onRunAutomation={(automation) => runAutomation.mutate(automation.id)}
            onTaskPress={(taskId) => router.push(`/tasks/${taskId}`)}
            onCreateTask={() => router.push(`/tasks/create?projectId=${projectId}`)}
          />
        ) : null}
        {section === 'work' ? (
          <ProjectWork
            tasks={data.tasks}
            sessions={sessions.data ?? []}
            sessionsLoading={sessions.isLoading}
            sessionsError={sessions.isError}
            onTaskPress={(taskId) => router.push(`/tasks/${taskId}`)}
            onSessionPress={(sessionKey) => openChat(router, sessionKey)}
            onCreateTask={() => router.push(`/tasks/create?projectId=${projectId}`)}
            onCreateChat={() => createChat.mutate()}
          />
        ) : null}
        {section === 'context' ? (
          <ProjectContext
            notes={notes.data?.items ?? []}
            files={files.data?.entries ?? []}
            loading={notes.isLoading || files.isLoading}
            notesError={notes.isError}
            filesError={files.isError}
            onNotePress={(noteId) => openNoteDetail(router, noteId)}
            onCreateNote={() => createNote.mutate()}
            onBrowseFiles={(dir = '') => router.push({ pathname: '/files', params: { projectId, dir } })}
          />
        ) : null}
      </ScrollView>
      <BottomSheetModal visible={createMenuVisible} onDismiss={() => setCreateMenuVisible(false)} title={labels.projectCreateTitle} subtitle={labels.projectCreateHint} maxHeight="58%">
        <ProjectCreateAction icon="message-plus-outline" title={labels.createProjectChat} description={labels.createProjectChatHint} loading={createChat.isPending} disabled={createChat.isPending || createNote.isPending} onPress={() => createChat.mutate()} />
        <ProjectCreateAction icon="clipboard-plus-outline" title={labels.createProjectTask} description={labels.createProjectTaskHint} disabled={createChat.isPending || createNote.isPending} onPress={() => { setCreateMenuVisible(false); router.push(`/tasks/create?projectId=${projectId}`); }} />
        <ProjectCreateAction icon="note-plus-outline" title={labels.createProjectNote} description={labels.createProjectNoteHint} loading={createNote.isPending} disabled={createChat.isPending || createNote.isPending} onPress={() => createNote.mutate()} />
        {createChat.error || createNote.error ? <Text style={[styles.createError, { color: colors.semantic.error }]}>{(createChat.error ?? createNote.error)?.message}</Text> : null}
      </BottomSheetModal>
      <BottomSheetModal visible={settingsVisible} onDismiss={() => setSettingsVisible(false)} title={labels.projectSettings} subtitle={labels.projectSettingsHint} maxHeight="48%">
        <ProjectCreateAction
          icon={details.data?.pinnedAt ? 'pin-off-outline' : 'pin-outline'}
          title={details.data?.pinnedAt ? labels.projectUnpin : labels.projectPin}
          description={labels.projectPinHint}
          loading={changePinned.isPending}
          disabled={changePinned.isPending || changeArchived.isPending || details.isLoading}
          onPress={() => changePinned.mutate(Boolean(details.data?.pinnedAt))}
        />
        <ProjectCreateAction
          icon={details.data?.status === 'archived' ? 'archive-arrow-up-outline' : 'archive-outline'}
          title={details.data?.status === 'archived' ? labels.projectRestore : labels.projectArchive}
          description={labels.projectArchiveHint}
          loading={changeArchived.isPending}
          disabled={changePinned.isPending || changeArchived.isPending || details.isLoading}
          onPress={() => changeArchived.mutate(details.data?.status === 'archived')}
        />
        {details.error || changePinned.error || changeArchived.error ? <Text style={[styles.createError, { color: colors.semantic.error }]}>{(details.error ?? changePinned.error ?? changeArchived.error)?.message}</Text> : null}
      </BottomSheetModal>
    </View>
  );
}

function ProjectSectionTabs({ value, onChange }: { value: ProjectSection; onChange: (value: ProjectSection) => void }) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const tabs: Array<{ key: ProjectSection; label: string }> = [
    { key: 'overview', label: labels.projectOverview },
    { key: 'work', label: labels.projectWork },
    { key: 'context', label: labels.projectContext },
  ];
  return <View style={[styles.tabs, { backgroundColor: colors.surface.input }]}>{tabs.map((tab) => {
    const selected = value === tab.key;
    return <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => onChange(tab.key)} style={[styles.tab, selected && { backgroundColor: colors.surface.panel }]}>
      <Text style={[styles.tabText, { color: selected ? colors.text.primary : colors.text.tertiary }]}>{tab.label}</Text>
    </Pressable>;
  })}</View>;
}

function ProjectOverview({ tasks, receipts, health, recommendation, activity, activityLoading, activityError, automations, automationsLoading, automationsError, automationPendingId, onToggleAutomation, onRunAutomation, onTaskPress, onCreateTask }: {
  tasks: ProjectTaskCard[];
  receipts: Array<{ taskId: string; taskTitle: string; receipt: TaskRunReceipt }>;
  health: string;
  recommendation?: string;
  activity: ProjectActivityEvent[];
  activityLoading: boolean;
  activityError: boolean;
  automations: Automation[];
  automationsLoading: boolean;
  automationsError: boolean;
  automationPendingId?: string;
  onToggleAutomation: (automation: Automation) => void;
  onRunAutomation: (automation: Automation) => void;
  onTaskPress: (taskId: string) => void;
  onCreateTask: () => void;
}) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const grouped = groupProjectTasks(tasks);
  const focusTask = grouped.needsUser[0] ?? grouped.moving[0] ?? grouped.other.find((task) => task.phase === 'ready');
  const healthColor = health === 'attention' ? colors.semantic.warning : health === 'healthy' ? colors.semantic.success : colors.text.tertiary;
  return <>
    <View style={[styles.pulse, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
      <View style={styles.pulseTitleRow}><View style={[styles.healthDot, { backgroundColor: healthColor }]} /><Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.projectPulse}</Text></View>
      <Text style={[styles.body, { color: colors.text.secondary }]}>{tasks.length ? t(labels.projectPulseSummary, { moving: grouped.moving.length, needsUser: grouped.needsUser.length }) : labels.projectEmptyPulse}</Text>
      {recommendation ? <Text style={[styles.recommendation, { color: colors.text.primary }]}>{recommendation}</Text> : null}
      <Button mode="contained" icon={focusTask ? 'arrow-right' : 'plus'} onPress={() => focusTask ? onTaskPress(focusTask.id) : onCreateTask()}>{focusTask ? labels.projectContinue : labels.create}</Button>
    </View>
    <ProjectTaskGroup title={labels.projectNeedsYou} tasks={grouped.needsUser.slice(0, 3)} onPress={onTaskPress} emphasis />
    <ProjectTaskGroup title={labels.projectMoving} tasks={grouped.moving.slice(0, 3)} onPress={onTaskPress} />
    {receipts.length ? <ProjectCard title={labels.recentResults}>{receipts.slice(0, 3).map((result) => <ProjectReceiptRow key={result.receipt.runId} receipt={result.receipt} taskTitle={result.taskTitle} onPress={() => onTaskPress(result.taskId)} />)}</ProjectCard> : null}
    <ProjectCard title={labels.projectAutomations}>
      {automationsLoading ? <ActivityIndicator style={styles.inlineLoader} /> : automationsError ? <ProjectEmpty icon="alert-circle-outline" text={labels.projectAutomationsLoadFailed} /> : automations.length ? automations.slice(0, 3).map((automation) => (
        <ProjectAutomationRow
          key={automation.id}
          automation={automation}
          pending={automationPendingId === automation.id}
          onToggle={() => onToggleAutomation(automation)}
          onRun={() => onRunAutomation(automation)}
        />
      )) : <ProjectEmpty icon="robot-outline" text={labels.projectNoAutomations} />}
    </ProjectCard>
    <ProjectCard title={labels.projectActivity}>
      {activityLoading ? <ActivityIndicator style={styles.inlineLoader} /> : activityError ? <ProjectEmpty icon="alert-circle-outline" text={labels.projectActivityLoadFailed} /> : activity.length ? activity.slice(0, 5).map((event) => (
        <ProjectActivityRow key={event.id} event={event} />
      )) : <ProjectEmpty icon="history" text={labels.projectNoActivity} />}
    </ProjectCard>
  </>;
}

function ProjectWork({ tasks, sessions, sessionsLoading, sessionsError, onTaskPress, onSessionPress, onCreateTask, onCreateChat }: {
  tasks: ProjectTaskCard[];
  sessions: ProjectSession[];
  sessionsLoading: boolean;
  sessionsError: boolean;
  onTaskPress: (taskId: string) => void;
  onSessionPress: (sessionKey: string) => void;
  onCreateTask: () => void;
  onCreateChat: () => void;
}) {
  const labels = useMessages().tasksPage;
  const openTasks = tasks.filter((task) => task.phase !== 'closed');
  return <>
    <ProjectCard title={labels.tasks} actionLabel={labels.createProjectTask} onAction={onCreateTask}>
      {openTasks.length ? openTasks.map((task) => <ProjectTaskRow key={task.id} task={task} onPress={() => onTaskPress(task.id)} />) : <ProjectEmpty icon="clipboard-text-outline" text={labels.projectNoTasks} />}
    </ProjectCard>
    <ProjectCard title={labels.projectChats} actionLabel={labels.createProjectChat} onAction={onCreateChat}>
      {sessionsLoading ? <ActivityIndicator style={styles.inlineLoader} /> : sessionsError ? <ProjectEmpty icon="alert-circle-outline" text={labels.projectChatsLoadFailed} /> : sessions.length ? sessions.map((session) => <ProjectSimpleRow key={session.key} icon="message-text-outline" title={sessionTitle(session, labels.projectUntitledChat)} subtitle={session.messageCount != null ? t(labels.projectChatMessages, { count: session.messageCount }) : undefined} onPress={() => onSessionPress(session.key)} />) : <ProjectEmpty icon="message-text-outline" text={labels.projectNoChats} />}
    </ProjectCard>
  </>;
}

function ProjectContext({ notes, files, loading, notesError, filesError, onNotePress, onCreateNote, onBrowseFiles }: {
  notes: Awaited<ReturnType<typeof fetchNotes>>['items'];
  files: ProjectFileEntry[];
  loading: boolean;
  notesError: boolean;
  filesError: boolean;
  onNotePress: (noteId: string) => void;
  onCreateNote: () => void;
  onBrowseFiles: (dir?: string) => void;
}) {
  const labels = useMessages().tasksPage;
  const recentFiles = [...files].filter((entry) => entry.type === 'file').sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? '')).slice(0, 5);
  if (loading) return <View style={styles.contextLoading}><ListSkeleton count={4} /></View>;
  return <>
    <ProjectCard title={labels.projectNotes} actionLabel={labels.createProjectNote} onAction={onCreateNote}>
      {notesError ? <ProjectEmpty icon="alert-circle-outline" text={labels.projectNotesLoadFailed} /> : notes.length ? notes.map((note) => <ProjectSimpleRow key={note.id} icon="note-text-outline" title={resolveNoteListTitle(note, labels.projectUntitledNote)} subtitle={note.snippet} onPress={() => onNotePress(note.id)} />) : <ProjectEmpty icon="note-text-outline" text={labels.projectNoNotes} />}
    </ProjectCard>
    <ProjectCard title={labels.projectFiles} actionLabel={labels.projectBrowseFiles} onAction={() => onBrowseFiles('')}>
      {filesError ? <ProjectEmpty icon="alert-circle-outline" text={labels.projectFilesLoadFailed} /> : recentFiles.length ? recentFiles.map((file) => <ProjectSimpleRow key={file.path} icon={fileIcon(file)} title={file.name} subtitle={file.path} onPress={() => onBrowseFiles(file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '')} />) : <ProjectEmpty icon="folder-open-outline" text={labels.projectNoFiles} />}
    </ProjectCard>
  </>;
}

function ProjectCard({ title, actionLabel, onAction, children }: { title: string; actionLabel?: string; onAction?: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.card, { borderColor: colors.border.subtle, backgroundColor: colors.surface.panel }]}>
    <View style={styles.cardHeader}><Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{title}</Text>{actionLabel && onAction ? <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}><Text style={[styles.cardAction, { color: colors.accent.primary }]}>{actionLabel}</Text></Pressable> : null}</View>
    {children}
  </View>;
}

function ProjectTaskGroup({ title, tasks, onPress, emphasis }: { title: string; tasks: ProjectTaskCard[]; onPress: (taskId: string) => void; emphasis?: boolean }) {
  const { colors } = useTheme();
  if (!tasks.length) return null;
  return <ProjectCard title={`${title} · ${tasks.length}`}><View style={emphasis ? { borderLeftColor: colors.semantic.warning, borderLeftWidth: 2 } : undefined}>{tasks.map((task) => <ProjectTaskRow key={task.id} task={task} onPress={() => onPress(task.id)} />)}</View></ProjectCard>;
}

function ProjectSimpleRow({ icon, title, subtitle, onPress }: { icon: string; title: string; subtitle?: string; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.simpleRow, pressed && { backgroundColor: colors.surface.pressed }]}>
    <View style={[styles.rowIcon, { backgroundColor: colors.surface.grouped }]}><Icon source={icon} size={20} color={colors.text.secondary} /></View>
    <View style={styles.taskBody}><Text style={[styles.taskTitle, { color: colors.text.primary }]} numberOfLines={1}>{title}</Text>{subtitle ? <Text style={[styles.meta, { color: colors.text.tertiary }]} numberOfLines={1}>{subtitle}</Text> : null}</View>
    <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
  </Pressable>;
}

function ProjectEmpty({ icon, text }: { icon: string; text: string }) {
  const { colors } = useTheme();
  return <View style={styles.empty}><Icon source={icon} size={28} color={colors.text.tertiary} /><Text style={[styles.body, { color: colors.text.tertiary }]}>{text}</Text></View>;
}

function ProjectAutomationRow({ automation, pending, onToggle, onRun }: { automation: Automation; pending: boolean; onToggle: () => void; onRun: () => void }) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const status = automation.state.runningRunId
    ? labels.projectAutomationRunning
    : automation.state.lastRunStatus === 'failed' || automation.state.lastRunStatus === 'timeout'
      ? labels.projectAutomationFailed
      : automation.enabled ? labels.projectAutomationEnabled : labels.projectAutomationPaused;
  return <View style={styles.automationRow}>
    <View style={[styles.rowIcon, { backgroundColor: colors.surface.grouped }]}><Icon source="robot-outline" size={20} color={colors.text.secondary} /></View>
    <View style={styles.taskBody}><Text style={[styles.taskTitle, { color: colors.text.primary }]} numberOfLines={1}>{automation.name}</Text><Text style={[styles.meta, { color: automation.state.lastRunStatus === 'failed' ? colors.semantic.error : colors.text.tertiary }]}>{status}</Text></View>
    {pending ? <ActivityIndicator size={20} /> : <>
      <Pressable accessibilityRole="button" accessibilityLabel={labels.projectRunAutomation} hitSlop={8} disabled={Boolean(automation.state.runningRunId)} onPress={onRun} style={styles.iconAction}><Icon source="play-outline" size={22} color={automation.state.runningRunId ? colors.text.tertiary : colors.accent.primary} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={automation.enabled ? labels.projectPauseAutomation : labels.projectResumeAutomation} hitSlop={8} onPress={onToggle} style={styles.iconAction}><Icon source={automation.enabled ? 'pause-circle-outline' : 'play-circle-outline'} size={22} color={colors.text.secondary} /></Pressable>
    </>}
  </View>;
}

function ProjectActivityRow({ event }: { event: ProjectActivityEvent }) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const kindLabel = {
    task: labels.projectActivityTask,
    session: labels.projectActivityChat,
    note: labels.projectActivityNote,
    automation: labels.projectActivityAutomation,
    workflow_run: labels.projectActivityWorkflow,
    project: labels.projectsTitle,
  }[event.primaryObject.kind] ?? event.primaryObject.kind;
  const actionLabel = event.type.includes('created') ? labels.projectActivityCreated
    : event.type.includes('completed') ? labels.projectActivityCompleted
      : event.type.includes('deleted') ? labels.projectActivityDeleted
        : labels.projectActivityUpdated;
  return <View style={styles.activityRow}>
    <View style={[styles.activityDot, { backgroundColor: event.importance === 'high' ? colors.semantic.warning : colors.border.default }]} />
    <View style={styles.taskBody}><Text style={[styles.taskTitle, { color: colors.text.primary }]} numberOfLines={1}>{event.primaryObject.title?.trim() || event.primaryObject.id}</Text><Text style={[styles.meta, { color: colors.text.tertiary }]}>{kindLabel} · {actionLabel}</Text></View>
  </View>;
}

function ProjectCreateAction({ icon, title, description, loading, disabled, onPress }: { icon: string; title: string; description: string; loading?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.createAction, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel, opacity: disabled ? 0.55 : 1 }]}>
    <View style={[styles.createActionIcon, { backgroundColor: colors.accent.soft }]}><Icon source={icon} size={22} color={colors.accent.primary} /></View>
    <View style={styles.createActionBody}><Text style={[styles.taskTitle, { color: colors.text.primary }]}>{title}</Text><Text style={[styles.body, { color: colors.text.secondary }]}>{description}</Text></View>
    {loading ? <ActivityIndicator size={20} color={colors.accent.primary} /> : <Icon source="chevron-right" size={20} color={colors.text.tertiary} />}
  </Pressable>;
}

function ProjectTaskRow({ task, onPress }: { task: ProjectTaskCard; onPress: () => void }) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const needsUser = task.attention.some((item) => item.kind === 'input_required' || item.kind === 'approval_required');
  const phaseLabel = { backlog: labels.projectBacklog, ready: labels.projectReady, active: labels.projectActive, review: labels.projectReview, closed: labels.projectDone }[task.phase];
  const stateLabel = needsUser ? labels.projectNeedsYou : task.operationalState === 'waiting' || task.operationalState === 'blocked' ? labels.projectWaiting : task.operationalState === 'queued' || task.operationalState === 'running' || task.operationalState === 'verifying' ? labels.projectMoving : undefined;
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.taskRow, pressed && { backgroundColor: colors.surface.pressed }]}>
    <View style={styles.taskBody}><Text style={[styles.taskTitle, { color: colors.text.primary }]} numberOfLines={2}>{task.title}</Text><Text style={[styles.meta, { color: needsUser ? colors.semantic.warning : colors.text.tertiary }]}>{stateLabel ? `${phaseLabel} · ${stateLabel}` : phaseLabel}</Text>{task.attention[0] ? <Text style={[styles.body, { color: colors.text.secondary }]} numberOfLines={2}>{task.attention[0].summary}</Text> : null}</View>
    <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
  </Pressable>;
}

function ProjectReceiptRow({ receipt, taskTitle, onPress }: { receipt: TaskRunReceipt; taskTitle: string; onPress: () => void }) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const verification = { passed: labels.resultPassed, failed: labels.resultFailed, unverified: labels.resultUnverified }[receipt.verification.status];
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.receipt, pressed && { backgroundColor: colors.surface.pressed }]}><View style={styles.taskBody}><Text style={[styles.taskTitle, { color: colors.text.primary }]} numberOfLines={1}>{taskTitle}</Text><Text style={[styles.body, { color: colors.text.secondary }]} numberOfLines={2}>{receipt.summary}</Text><Text style={[styles.meta, { color: receipt.verification.status === 'failed' ? colors.semantic.error : colors.text.tertiary }]}>{verification}</Text></View><Icon source="chevron-right" size={20} color={colors.text.tertiary} /></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, skeleton: { padding: spacing.lg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  tabs: { flexDirection: 'row', marginHorizontal: spacing.lg, marginBottom: spacing.xs, padding: 3, borderRadius: radii.md },
  tab: { flex: 1, minHeight: 36, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' }, tabText: { ...typography.label, fontWeight: '600' },
  pulse: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm }, pulseTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, healthDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { ...typography.heading }, recommendation: { ...typography.body, fontWeight: '600' }, body: { ...typography.body }, meta: { ...typography.label }, taskTitle: { ...typography.ui, fontWeight: '600' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, overflow: 'hidden' }, cardHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, gap: spacing.sm }, cardAction: { ...typography.label, fontWeight: '600' },
  taskRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, simpleRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, rowIcon: { width: 36, height: 36, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' }, taskBody: { flex: 1, minWidth: 0, gap: spacing.xxs },
  receipt: { minHeight: 72, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, flexDirection: 'row', alignItems: 'center' }, empty: { minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.lg }, inlineLoader: { marginVertical: spacing.xl }, contextLoading: { minHeight: 280 },
  automationRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, iconAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }, activityRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, activityDot: { width: 8, height: 8, borderRadius: 4 },
  createAction: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md }, createActionIcon: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' }, createActionBody: { flex: 1, minWidth: 0, gap: spacing.xxs }, createError: { ...typography.caption, paddingHorizontal: spacing.xl, paddingTop: spacing.sm }, inlineError: { ...typography.caption, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
