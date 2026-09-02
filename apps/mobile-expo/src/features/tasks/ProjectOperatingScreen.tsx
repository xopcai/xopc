import type { Automation, FileResource, ProjectOperatingView, ProjectTaskCard, TaskRunReceipt } from '@xopcai/gateway-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { t, useMessages } from '../../i18n/messages';
import { dismissOrHome, openChat, openNoteDetail } from '../../lib/navigation';
import { fetchAutomations, runAutomationNow, setAutomationEnabled } from '../../query/automations';
import { queryKeys } from '../../query/keys';
import { fetchFileChildren, fetchFileSpaceForContext } from '../../query/files';
import { captureNote, fetchNotes } from '../../query/notes';
import {
  fetchProject,
  fetchProjectActivity,
  fetchProjectOperatingView,
  fetchProjectSessions,
  fetchProjectSkills,
  pinProject,
  unpinProject,
  updateProjectStatus,
  type ProjectActivityEvent,
  type ProjectDetails,
  type ProjectMilestone,
  type ProjectSession,
  type ProjectSkillsResponse,
  type ProjectUpdate,
} from '../../query/projects';
import { createSession, useGatewayConfigured } from '../../query/sessions';
import { usePreferencesStore } from '../../stores/preferences-store';
import { radii, spacing, typography, useTheme } from '../../theme';
import { resolveNoteListTitle } from '../notes/note-title';

import { formatProjectRelativeTime, groupProjectTasks } from './project-presentation';

type ProjectSection = 'overview' | 'work' | 'context' | 'progress';

const PROJECT_SECTION_INDEX: Record<ProjectSection, number> = {
  overview: 0,
  work: 1,
  context: 2,
  progress: 3,
};

const PROJECT_SECTIONS: ProjectSection[] = ['overview', 'work', 'context', 'progress'];

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function sessionTitle(session: ProjectSession, fallback: string): string {
  return session.name?.trim() || session.title?.trim() || session.displayName?.trim() || fallback;
}

function fileIcon(entry: FileResource): string {
  if (entry.kind === 'directory') return 'folder-outline';
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
  const pagerRef = useRef<PagerView>(null);
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
  const fileSpace = useQuery({
    queryKey: queryKeys.fileSpaceContext('project', projectId),
    queryFn: () => fetchFileSpaceForContext('project', projectId),
    enabled: configured && Boolean(projectId) && section === 'context',
  });
  const files = useQuery({
    queryKey: queryKeys.fileChildren(fileSpace.data?.id ?? '', ''),
    queryFn: () => fetchFileChildren(fileSpace.data!.id),
    enabled: Boolean(fileSpace.data) && section === 'context',
  });
  const activity = useQuery({
    queryKey: queryKeys.projectActivity(projectId),
    queryFn: () => fetchProjectActivity(projectId, 50),
    enabled: configured && Boolean(projectId) && section === 'progress',
  });
  const automations = useQuery({
    queryKey: queryKeys.projectAutomations(projectId),
    queryFn: () => fetchAutomations(projectId),
    enabled: configured && Boolean(projectId) && section === 'progress',
  });
  const skills = useQuery({
    queryKey: queryKeys.projectSkills(projectId),
    queryFn: () => fetchProjectSkills(projectId),
    enabled: configured && Boolean(projectId) && section === 'context',
  });
  const details = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => fetchProject(projectId),
    enabled: configured && Boolean(projectId),
  });
  const createChat = useMutation({
    mutationFn: () => createSession({ projectId }),
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
  const selectSection = useCallback((nextSection: ProjectSection) => {
    setSection(nextSection);
    pagerRef.current?.setPage(PROJECT_SECTION_INDEX[nextSection]);
  }, []);
  const onPageSelected = useCallback((position: number) => {
    const nextSection = PROJECT_SECTIONS[position];
    if (nextSection) setSection(nextSection);
  }, []);
  const refresh = (nextSection: ProjectSection) => {
    void view.refetch();
    void details.refetch();
    if (nextSection === 'work') void sessions.refetch();
    if (nextSection === 'context') { void notes.refetch(); void fileSpace.refetch(); void files.refetch(); void skills.refetch(); }
    if (nextSection === 'progress') { void activity.refetch(); void automations.refetch(); }
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
      <ProjectSectionTabs value={section} onChange={selectSection} />
      {createChat.error || createNote.error || toggleAutomation.error || runAutomation.error ? (
        <Text style={[styles.inlineError, { color: colors.semantic.error }]}>
          {(createChat.error ?? createNote.error ?? toggleAutomation.error ?? runAutomation.error)?.message}
        </Text>
      ) : null}
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={PROJECT_SECTION_INDEX.overview}
        onPageSelected={(event) => onPageSelected(event.nativeEvent.position)}
      >
        <View key="overview" style={styles.page} collapsable={false}>
          <ScrollView
            refreshControl={<RefreshControl refreshing={view.isFetching || details.isFetching} onRefresh={() => refresh('overview')} />}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <ProjectOverview
              tasks={data.tasks}
              receipts={data.recentResults}
              project={details.data}
              fallbackDirection={data.project.description || data.project.brief || data.digest.summary}
              blockers={data.blockers}
              health={data.digest.health}
              recommendation={data.digest.recommendedAction}
              onTaskPress={(taskId) => router.push(`/tasks/${taskId}`)}
              onCreateTask={() => router.push(`/tasks/create?projectId=${projectId}`)}
            />
          </ScrollView>
        </View>
        <View key="work" style={styles.page} collapsable={false}>
          <ScrollView
            refreshControl={<RefreshControl refreshing={view.isFetching || sessions.isFetching} onRefresh={() => refresh('work')} />}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
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
          </ScrollView>
        </View>
        <View key="context" style={styles.page} collapsable={false}>
          <ScrollView
            refreshControl={<RefreshControl refreshing={view.isFetching || notes.isFetching || fileSpace.isFetching || files.isFetching || skills.isFetching} onRefresh={() => refresh('context')} />}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <ProjectContext
              notes={notes.data?.items ?? []}
              files={files.data ?? []}
              loading={notes.isLoading || fileSpace.isLoading || files.isLoading}
              notesError={notes.isError}
              filesError={files.isError}
              skills={skills.data}
              skillsLoading={skills.isLoading}
              skillsError={skills.isError}
              onNotePress={(noteId) => openNoteDetail(router, noteId)}
              onCreateNote={() => createNote.mutate()}
              onBrowseFiles={() => router.push(`/files/context/project/${encodeURIComponent(projectId)}` as never)}
              onBrowseSkills={() => router.push(`/projects/${encodeURIComponent(projectId)}/skills`)}
            />
          </ScrollView>
        </View>
        <View key="progress" style={styles.page} collapsable={false}>
          <ScrollView
            refreshControl={<RefreshControl refreshing={view.isFetching || details.isFetching || activity.isFetching || automations.isFetching} onRefresh={() => refresh('progress')} />}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <ProjectProgress
              tasks={data.tasks}
              receipts={data.recentResults}
              milestones={details.data?.milestones ?? []}
              updates={details.data?.recentUpdates ?? []}
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
            />
          </ScrollView>
        </View>
      </PagerView>
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
    { key: 'progress', label: labels.projectProgress },
  ];
  return <View style={[styles.tabs, { backgroundColor: colors.surface.input }]}>{tabs.map((tab) => {
    const selected = value === tab.key;
    return <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => onChange(tab.key)} style={[styles.tab, selected && { backgroundColor: colors.surface.panel }]}>
      <Text style={[styles.tabText, { color: selected ? colors.text.primary : colors.text.tertiary }]}>{tab.label}</Text>
    </Pressable>;
  })}</View>;
}

function ProjectOverview({ tasks, receipts, project, fallbackDirection, blockers, health, recommendation, onTaskPress, onCreateTask }: {
  tasks: ProjectTaskCard[];
  receipts: Array<{ taskId: string; taskTitle: string; receipt: TaskRunReceipt }>;
  project?: ProjectDetails;
  fallbackDirection: string;
  blockers: ProjectOperatingView['blockers'];
  health: string;
  recommendation?: string;
  onTaskPress: (taskId: string) => void;
  onCreateTask: () => void;
}) {
  const { colors } = useTheme();
  const labels = useMessages().tasksPage;
  const grouped = groupProjectTasks(tasks);
  const focusTask = grouped.needsUser[0] ?? grouped.moving[0] ?? grouped.other.find((task) => task.phase === 'ready');
  const healthColor = health === 'attention' ? colors.semantic.warning : health === 'healthy' ? colors.semantic.success : colors.text.tertiary;
  const direction = project?.outcome?.trim() || project?.description?.trim() || project?.brief?.trim() || fallbackDirection;
  const currentMilestones = (project?.milestones ?? []).filter((milestone) => milestone.status !== 'cancelled').slice(0, 3);
  return <>
    <ProjectCard title={labels.projectDirection}>
      <View style={styles.summaryBody}>
        <Text style={[styles.body, { color: colors.text.secondary }]}>{direction}</Text>
      </View>
    </ProjectCard>
    <View style={[styles.pulse, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
      <View style={styles.pulseTitleRow}><View style={[styles.healthDot, { backgroundColor: healthColor }]} /><Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{labels.projectPulse}</Text></View>
      <Text style={[styles.body, { color: colors.text.secondary }]}>{tasks.length ? t(labels.projectPulseSummary, { moving: grouped.moving.length, needsUser: grouped.needsUser.length }) : labels.projectEmptyPulse}</Text>
      {recommendation ? <Text style={[styles.recommendation, { color: colors.text.primary }]}>{recommendation}</Text> : null}
      <Button mode="contained" icon={focusTask ? 'arrow-right' : 'plus'} onPress={() => focusTask ? onTaskPress(focusTask.id) : onCreateTask()}>{focusTask ? labels.projectContinue : labels.create}</Button>
    </View>
    {blockers.length ? <ProjectCard title={labels.projectBlockers}>
      {blockers.slice(0, 3).map((blocker) => (
        <ProjectSimpleRow key={blocker.id} icon="alert-circle-outline" title={blocker.title} subtitle={blocker.detail} onPress={() => onTaskPress(blocker.taskId)} />
      ))}
    </ProjectCard> : null}
    {currentMilestones.length ? <ProjectCard title={labels.projectMilestones}>
      {currentMilestones.map((milestone) => <ProjectMilestoneRow key={milestone.id} milestone={milestone} />)}
    </ProjectCard> : null}
    <ProjectTaskGroup title={labels.projectNeedsYou} tasks={grouped.needsUser.slice(0, 3)} onPress={onTaskPress} emphasis />
    <ProjectTaskGroup title={labels.projectMoving} tasks={grouped.moving.slice(0, 3)} onPress={onTaskPress} />
    {receipts.length ? <ProjectCard title={labels.recentResults}>{receipts.slice(0, 3).map((result) => <ProjectReceiptRow key={result.receipt.runId} receipt={result.receipt} taskTitle={result.taskTitle} onPress={() => onTaskPress(result.taskId)} />)}</ProjectCard> : null}
  </>;
}

function ProjectProgress({ tasks, receipts, milestones, updates, activity, activityLoading, activityError, automations, automationsLoading, automationsError, automationPendingId, onToggleAutomation, onRunAutomation, onTaskPress }: {
  tasks: ProjectTaskCard[];
  receipts: Array<{ taskId: string; taskTitle: string; receipt: TaskRunReceipt }>;
  milestones: ProjectMilestone[];
  updates: ProjectUpdate[];
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
}) {
  const labels = useMessages().tasksPage;
  const completedTasks = tasks.filter((task) => task.phase === 'closed');
  const visibleMilestones = milestones.filter((milestone) => milestone.status !== 'cancelled');
  return <>
    <ProjectCard title={labels.projectMilestones}>
      {visibleMilestones.length
        ? visibleMilestones.map((milestone) => <ProjectMilestoneRow key={milestone.id} milestone={milestone} />)
        : <ProjectEmpty icon="flag-outline" text={labels.projectNoMilestones} />}
    </ProjectCard>
    <ProjectCard title={labels.projectUpdates}>
      {updates.length
        ? updates.map((update) => <ProjectUpdateRow key={update.id} update={update} />)
        : <ProjectEmpty icon="chart-timeline-variant" text={labels.projectNoUpdates} />}
    </ProjectCard>
    <ProjectCard title={labels.projectAutomations}>
      {automationsLoading ? <ActivityIndicator style={styles.inlineLoader} /> : automationsError ? <ProjectEmpty icon="alert-circle-outline" text={labels.projectAutomationsLoadFailed} /> : automations.length ? automations.map((automation) => (
        <ProjectAutomationRow
          key={automation.id}
          automation={automation}
          pending={automationPendingId === automation.id}
          onToggle={() => onToggleAutomation(automation)}
          onRun={() => onRunAutomation(automation)}
        />
      )) : <ProjectEmpty icon="robot-outline" text={labels.projectNoAutomations} />}
    </ProjectCard>
    <ProjectCard title={labels.projectResults}>
      {receipts.length
        ? receipts.map((result) => <ProjectReceiptRow key={result.receipt.runId} receipt={result.receipt} taskTitle={result.taskTitle} onPress={() => onTaskPress(result.taskId)} />)
        : <ProjectEmpty icon="check-decagram-outline" text={labels.projectNoResults} />}
    </ProjectCard>
    <ProjectCard title={labels.projectCompletedWork}>
      {completedTasks.length
        ? completedTasks.map((task) => <ProjectTaskRow key={task.id} task={task} onPress={() => onTaskPress(task.id)} />)
        : <ProjectEmpty icon="check-circle-outline" text={labels.projectNoCompletedWork} />}
    </ProjectCard>
    <ProjectCard title={labels.projectActivity}>
      {activityLoading ? <ActivityIndicator style={styles.inlineLoader} /> : activityError ? <ProjectEmpty icon="alert-circle-outline" text={labels.projectActivityLoadFailed} /> : activity.length ? activity.map((event) => (
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

function ProjectContext({ notes, files, loading, notesError, filesError, skills, skillsLoading, skillsError, onNotePress, onCreateNote, onBrowseFiles, onBrowseSkills }: {
  notes: Awaited<ReturnType<typeof fetchNotes>>['items'];
  files: FileResource[];
  loading: boolean;
  notesError: boolean;
  filesError: boolean;
  skills?: ProjectSkillsResponse;
  skillsLoading: boolean;
  skillsError: boolean;
  onNotePress: (noteId: string) => void;
  onCreateNote: () => void;
  onBrowseFiles: () => void;
  onBrowseSkills: () => void;
}) {
  const labels = useMessages().tasksPage;
  const recentFiles = [...files].filter((entry) => entry.kind === 'file').sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 5);
  if (loading || skillsLoading) return <View style={styles.contextLoading}><ListSkeleton count={4} /></View>;
  const skillCount = (skills?.items.length ?? 0) + (skills?.inheritedItems.length ?? 0);
  const skillWarning = skills?.sources.some((source) => ['untrusted', 'disabled', 'invalid'].includes(source.state))
    || skills?.diagnostics.some((diagnostic) => diagnostic.type !== 'skipped');
  return <>
    <ProjectCard title={labels.projectNotes} actionLabel={labels.createProjectNote} onAction={onCreateNote}>
      {notesError ? <ProjectEmpty icon="alert-circle-outline" text={labels.projectNotesLoadFailed} /> : notes.length ? notes.map((note) => <ProjectSimpleRow key={note.id} icon="note-text-outline" title={resolveNoteListTitle(note, labels.projectUntitledNote)} subtitle={note.snippet} onPress={() => onNotePress(note.id)} />) : <ProjectEmpty icon="note-text-outline" text={labels.projectNoNotes} />}
    </ProjectCard>
    <ProjectCard title={labels.projectFiles} actionLabel={labels.projectBrowseFiles} onAction={onBrowseFiles}>
      {filesError ? <ProjectEmpty icon="alert-circle-outline" text={labels.projectFilesLoadFailed} /> : recentFiles.length ? recentFiles.map((file) => <ProjectSimpleRow key={file.id} icon={fileIcon(file)} title={file.name} subtitle={file.relativePath} onPress={onBrowseFiles} />) : <ProjectEmpty icon="folder-open-outline" text={labels.projectNoFiles} />}
    </ProjectCard>
    <ProjectCard title={labels.projectSkills} actionLabel={labels.projectViewSkills} onAction={onBrowseSkills}>
      {skillsError
        ? <ProjectEmpty icon="alert-circle-outline" text={labels.projectSkillsLoadFailed} />
        : <ProjectSimpleRow
          icon="creation-outline"
          title={skillCount ? t(labels.projectSkillsCount, { count: skillCount }) : labels.projectNoSkills}
          subtitle={skillWarning ? labels.projectSkillsNeedAttention : labels.projectSkillsSummary}
          onPress={onBrowseSkills}
        />}
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

function ProjectMilestoneRow({ milestone }: { milestone: ProjectMilestone }) {
  const { colors } = useTheme();
  const language = usePreferencesStore((state) => state.language);
  const labels = useMessages().tasksPage;
  const statusLabel = {
    planned: labels.projectMilestonePlanned,
    active: labels.projectMilestoneActive,
    completed: labels.projectMilestoneCompleted,
    cancelled: labels.projectMilestoneCancelled,
  }[milestone.status];
  const target = milestone.targetAt ? formatProjectRelativeTime(milestone.targetAt, language) : '';
  return <View style={styles.simpleRow}>
    <View style={[styles.rowIcon, { backgroundColor: milestone.status === 'completed' ? colors.accent.soft : colors.surface.grouped }]}>
      <Icon source={milestone.status === 'completed' ? 'flag-checkered' : 'flag-outline'} size={20} color={milestone.status === 'completed' ? colors.accent.primary : colors.text.secondary} />
    </View>
    <View style={styles.taskBody}>
      <Text style={[styles.taskTitle, { color: colors.text.primary }]} numberOfLines={2}>{milestone.title}</Text>
      <Text style={[styles.meta, { color: colors.text.tertiary }]}>{target ? `${statusLabel} · ${target}` : statusLabel}</Text>
      {milestone.description ? <Text style={[styles.body, { color: colors.text.secondary }]} numberOfLines={2}>{milestone.description}</Text> : null}
    </View>
  </View>;
}

function ProjectUpdateRow({ update }: { update: ProjectUpdate }) {
  const { colors } = useTheme();
  const language = usePreferencesStore((state) => state.language);
  const labels = useMessages().tasksPage;
  const healthLabel = {
    unknown: labels.projectHealthUnknown,
    on_track: labels.projectHealthOnTrack,
    at_risk: labels.projectHealthAtRisk,
    off_track: labels.projectHealthOffTrack,
  }[update.health];
  const detail = update.risks[0]
    ? `${labels.projectRisk}: ${update.risks[0]}`
    : update.nextSteps[0]
      ? `${labels.projectNextStep}: ${update.nextSteps[0]}`
      : update.progress[0];
  return <View style={styles.updateRow}>
    <View style={styles.taskBody}>
      <Text style={[styles.taskTitle, { color: colors.text.primary }]} numberOfLines={2}>{update.summary}</Text>
      <Text style={[styles.meta, { color: update.health === 'at_risk' || update.health === 'off_track' ? colors.semantic.warning : colors.text.tertiary }]}>
        {healthLabel} · {formatProjectRelativeTime(update.createdAt, language)}
      </Text>
      {detail ? <Text style={[styles.body, { color: colors.text.secondary }]} numberOfLines={2}>{detail}</Text> : null}
    </View>
  </View>;
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
  const language = usePreferencesStore((state) => state.language);
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
  const actor = event.actor.name?.trim() || event.actor.agentId?.trim();
  const detail = ['summary', 'message', 'reason', 'status', 'phase']
    .map((key) => event.payload[key])
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  return <View style={styles.activityRow}>
    <View style={[styles.activityDot, { backgroundColor: event.importance === 'high' ? colors.semantic.warning : colors.border.default }]} />
    <View style={styles.taskBody}>
      <Text style={[styles.taskTitle, { color: colors.text.primary }]} numberOfLines={1}>{event.primaryObject.title?.trim() || event.primaryObject.id}</Text>
      <Text style={[styles.meta, { color: colors.text.tertiary }]}>{kindLabel} · {actionLabel} · {formatProjectRelativeTime(event.createdAt, language)}</Text>
      {detail ? <Text style={[styles.body, { color: colors.text.secondary }]} numberOfLines={2}>{detail}</Text> : actor ? <Text style={[styles.body, { color: colors.text.secondary }]} numberOfLines={1}>{actor}</Text> : null}
    </View>
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
  pager: { flex: 1 }, page: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  tabs: { flexDirection: 'row', marginHorizontal: spacing.lg, marginBottom: spacing.xs, padding: 3, borderRadius: radii.md },
  tab: { flex: 1, minHeight: 44, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' }, tabText: { ...typography.label, fontWeight: '600' },
  summaryBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  pulse: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm }, pulseTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, healthDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { ...typography.heading }, recommendation: { ...typography.body, fontWeight: '600' }, body: { ...typography.body }, meta: { ...typography.label }, taskTitle: { ...typography.ui, fontWeight: '600' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, overflow: 'hidden' }, cardHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, gap: spacing.sm }, cardAction: { ...typography.label, fontWeight: '600' },
  taskRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, simpleRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, rowIcon: { width: 36, height: 36, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' }, taskBody: { flex: 1, minWidth: 0, gap: spacing.xxs },
  receipt: { minHeight: 72, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, flexDirection: 'row', alignItems: 'center' }, empty: { minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.lg }, inlineLoader: { marginVertical: spacing.xl }, contextLoading: { minHeight: 280 },
  automationRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, iconAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }, activityRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, activityDot: { width: 8, height: 8, borderRadius: 4 }, updateRow: { minHeight: 72, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  createAction: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md }, createActionIcon: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' }, createActionBody: { flex: 1, minWidth: 0, gap: spacing.xxs }, createError: { ...typography.caption, paddingHorizontal: spacing.xl, paddingTop: spacing.sm }, inlineError: { ...typography.caption, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
