import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionContextSummary } from '@xopcai/gateway-contract';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import { fetchProjectEnvironmentOptions, fetchProjects, type Project } from '../../query/projects';
import { fetchHostDirectories } from '../../query/host-fs';
import { fetchSessionAgentConfig, setSessionWorkingDirectory } from '../../query/models';
import { fetchSessionContextSummary } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';
import type { ComposerContextRef } from './composer.types';

function environmentLabel(environment: SessionContextSummary['environment']): string | undefined {
  if (!environment) return undefined;
  return environment.kind === 'managed_worktree' ? 'Worktree' : 'Local';
}

function ContextRow({ icon, title, subtitle, warning }: {
  icon: string;
  title: string;
  subtitle?: string;
  warning?: boolean;
}) {
  const { colors } = useTheme();
  return <View style={styles.row}>
    <Icon source={icon} size={20} color={warning ? colors.semantic.warning : colors.text.secondary} />
    <View style={styles.rowCopy}>
      <Text style={[styles.rowTitle, { color: colors.text.primary }]}>{title}</Text>
      {subtitle ? <Text style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>{subtitle}</Text> : null}
    </View>
  </View>;
}

type ExecutionMode = 'local_checkout' | 'managed_worktree';

export const ChatContextControl = memo(function ChatContextControl({
  sessionKey,
  draftRefs,
  onRemoveDraftRef,
  onAddSource,
  onChangeScope,
}: {
  sessionKey: string;
  draftRefs: ComposerContextRef[];
  onRemoveDraftRef: (sourceId: string) => void;
  onAddSource: () => void;
  onChangeScope: (projectId: string | null, executionMode?: ExecutionMode) => void;
}) {
  const { colors } = useTheme();
  const m = useMessages();
  const copy = m.chat.contextCenter;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedMode, setSelectedMode] = useState<ExecutionMode>('local_checkout');
  const [directoryPath, setDirectoryPath] = useState<string | undefined>(undefined);
  const [savingDirectory, setSavingDirectory] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const context = useQuery({
    queryKey: queryKeys.sessionContext(sessionKey),
    queryFn: () => fetchSessionContextSummary(sessionKey),
    enabled: Boolean(sessionKey),
  });
  const projects = useQuery({
    queryKey: queryKeys.projects,
    queryFn: fetchProjects,
    enabled: open && selecting,
  });
  const environmentOptions = useQuery({
    queryKey: ['projects', selectedProject?.id ?? '', 'environment-options'],
    queryFn: () => fetchProjectEnvironmentOptions(selectedProject!.id),
    enabled: Boolean(open && selecting && selectedProject),
  });
  const agentConfig = useQuery({
    queryKey: queryKeys.sessionAgentConfig(sessionKey),
    queryFn: () => fetchSessionAgentConfig(sessionKey),
    enabled: open,
  });
  const directories = useQuery({
    queryKey: ['host-directories', directoryPath ?? ''],
    queryFn: () => fetchHostDirectories(directoryPath),
    enabled: open && directoryPath !== undefined,
  });
  useEffect(() => {
    if (!selectedProject) return;
    setSelectedMode(selectedProject.executionMode ?? 'local_checkout');
  }, [selectedProject]);
  useEffect(() => {
    if (selectedMode === 'managed_worktree' && environmentOptions.data?.worktreeUnavailableReason
      && environmentOptions.data.localAvailable) {
      setSelectedMode('local_checkout');
    }
  }, [environmentOptions.data, selectedMode]);
  const selectedModeAllowed = Boolean(environmentOptions.data && (
    selectedMode === 'local_checkout'
      ? environmentOptions.data.localAvailable
      : !environmentOptions.data.worktreeUnavailableReason
  ));
  const changeScope = useCallback((projectId: string | null, mode?: ExecutionMode) => {
    setOpen(false);
    setSelecting(false);
    setSelectedProject(null);
    onChangeScope(projectId, mode);
  }, [onChangeScope]);
  const summary = context.data;
  const chips = useMemo(() => {
    const items: Array<{ key: string; icon: string; label: string; primary?: boolean }> = [];
    if (summary?.work.project) items.push({ key: 'project', icon: 'folder-outline', label: summary.work.project.title, primary: true });
    if (summary?.work.task) items.push({ key: 'task', icon: 'target', label: summary.work.task.title, primary: !summary.work.project });
    const environment = environmentLabel(summary?.environment);
    if (environment) items.push({ key: 'environment', icon: summary?.environment?.kind === 'managed_worktree' ? 'source-branch' : 'laptop', label: environment });
    const sourceCount = (summary?.sources.length ?? 0) + draftRefs.length;
    if (sourceCount) items.push({ key: 'sources', icon: 'notebook-outline', label: `${copy.sources} ${sourceCount}${summary?.sourcesHasMore ? '+' : ''}` });
    return items;
  }, [copy.sources, draftRefs.length, summary]);

  return <>
    <View style={styles.strip}>
      {context.isLoading ? <ActivityIndicator size={16} /> : null}
      {chips.map((chip) => <Pressable
        key={chip.key}
        accessibilityRole="button"
        accessibilityLabel={`${copy.open}: ${chip.label}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.chip,
          {
            backgroundColor: chip.primary ? colors.accent.soft : colors.surface.panel,
            borderColor: chip.primary ? colors.accent.soft : colors.border.subtle,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Icon source={chip.icon} size={15} color={chip.primary ? colors.accent.primary : colors.text.secondary} />
        <Text numberOfLines={1} style={[styles.chipText, { color: chip.primary ? colors.accent.primary : colors.text.secondary }]}>{chip.label}</Text>
      </Pressable>)}
      {!context.isLoading ? <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.open}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.contextButton, { opacity: pressed ? 0.65 : 1 }]}
      >
        <Icon source="layers-outline" size={16} color={colors.text.tertiary} />
        <Text style={[styles.contextButtonText, { color: colors.text.tertiary }]}>{copy.title}</Text>
      </Pressable> : null}
    </View>

    <BottomSheetModal
      visible={open}
      onDismiss={() => setOpen(false)}
      title={copy.title}
      subtitle={copy.subtitle}
      headerAction={selecting || directoryPath !== undefined ? <Pressable accessibilityRole="button" onPress={() => { setSelecting(false); setSelectedProject(null); setDirectoryPath(undefined); }}><Text style={{ color: colors.accent.primary }}>{m.common.cancel}</Text></Pressable> : undefined}
      maxHeight="82%"
      scroll
    >
      {context.isError ? <View style={styles.error}>
        <Text style={{ color: colors.text.secondary }}>{copy.loadFailed}</Text>
        <Pressable onPress={() => void context.refetch()} accessibilityRole="button">
          <Text style={{ color: colors.accent.primary }}>{m.common.retry}</Text>
        </Pressable>
      </View> : null}
      {context.isLoading ? <ActivityIndicator style={styles.loading} /> : null}
      {directoryPath !== undefined ? <>
        <Text numberOfLines={1} style={[styles.directoryPath, { color: colors.text.secondary }]}>{directories.data?.currentPath || directoryPath || copy.hostRoot}</Text>
        {directories.data?.parentPath != null ? <Pressable
          accessibilityRole="button"
          onPress={() => setDirectoryPath(directories.data!.parentPath ?? '')}
          style={({ pressed }) => [styles.choice, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.input }]}
        ><Icon source="arrow-up" size={20} color={colors.text.secondary} /><Text style={{ color: colors.text.primary }}>{copy.parentFolder}</Text></Pressable> : null}
        {directories.isLoading ? <ActivityIndicator style={styles.loading} /> : null}
        {directories.data?.entries.map((entry) => <Pressable
          key={entry.absolutePath}
          accessibilityRole="button"
          onPress={() => setDirectoryPath(entry.absolutePath)}
          style={({ pressed }) => [styles.choice, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.input }]}
        ><Icon source="folder-outline" size={20} color={colors.text.secondary} /><Text numberOfLines={1} style={[styles.rowTitle, styles.rowCopy, { color: colors.text.primary }]}>{entry.name}</Text></Pressable>)}
        {directories.isError ? <Text style={[styles.warning, { color: colors.semantic.error }]}>{copy.directoriesFailed}</Text> : null}
        {directories.data?.currentPath ? <Pressable
          accessibilityRole="button"
          disabled={savingDirectory}
          onPress={() => {
            setSavingDirectory(true);
            setDirectoryError(null);
            void setSessionWorkingDirectory(sessionKey, directories.data!.currentPath).then(async () => {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.sessionAgentConfig(sessionKey) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.sessionContext(sessionKey) }),
              ]);
              setDirectoryPath(undefined);
            }).catch((error) => setDirectoryError(error instanceof Error ? error.message : String(error)))
              .finally(() => setSavingDirectory(false));
          }}
          style={({ pressed }) => [styles.primaryAction, { backgroundColor: colors.accent.primary, opacity: savingDirectory || pressed ? 0.65 : 1 }]}
        ><Text style={[styles.primaryActionText, { color: colors.accent.onPrimary }]}>{copy.useFolder}</Text></Pressable> : null}
        {directoryError ? <Text style={[styles.warning, { color: colors.semantic.error }]}>{directoryError}</Text> : null}
      </> : selecting ? <>
        <Text style={[styles.sectionTitle, { color: colors.text.tertiary }]}>{copy.chooseProject}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => changeScope(null)}
          style={({ pressed }) => [styles.choice, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.input }]}
        >
          <Icon source="account-outline" size={20} color={colors.text.secondary} />
          <Text style={[styles.rowTitle, { color: colors.text.primary }]}>{copy.noProject}</Text>
        </Pressable>
        {projects.isLoading ? <ActivityIndicator style={styles.loading} /> : null}
        {projects.isError ? <Text style={[styles.warning, { color: colors.semantic.error }]}>{copy.projectsFailed}</Text> : null}
        {projects.data?.filter((project) => project.status !== 'archived').map((project) => <Pressable
          key={project.id}
          accessibilityRole="button"
          accessibilityState={{ selected: selectedProject?.id === project.id }}
          onPress={() => setSelectedProject(project)}
          style={({ pressed }) => [styles.choice, {
            backgroundColor: selectedProject?.id === project.id ? colors.accent.soft : pressed ? colors.surface.pressed : colors.surface.input,
          }]}
        >
          <Icon source="folder-outline" size={20} color={selectedProject?.id === project.id ? colors.accent.primary : colors.text.secondary} />
          <View style={styles.rowCopy}>
            <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{project.name}</Text>
            {project.description ? <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>{project.description}</Text> : null}
          </View>
        </Pressable>)}
        {selectedProject ? <View style={[styles.modePanel, { borderColor: colors.border.subtle }]}>
          <Text style={[styles.sectionTitle, { color: colors.text.tertiary }]}>{copy.chooseEnvironment}</Text>
          {environmentOptions.isLoading ? <ActivityIndicator style={styles.loading} /> : null}
          {environmentOptions.isError ? <Text style={[styles.warning, { color: colors.semantic.error }]}>{copy.environmentCheckFailed}</Text> : null}
          {environmentOptions.data ? <>
            <ModeChoice
              label="Local"
              icon="laptop"
              selected={selectedMode === 'local_checkout'}
              disabled={!environmentOptions.data.localAvailable}
              onPress={() => setSelectedMode('local_checkout')}
            />
            <ModeChoice
              label="Worktree"
              icon="source-branch"
              selected={selectedMode === 'managed_worktree'}
              disabled={Boolean(environmentOptions.data.worktreeUnavailableReason)}
              onPress={() => setSelectedMode('managed_worktree')}
            />
            {environmentOptions.data.worktreeUnavailableReason ? <Text style={[styles.warning, { color: colors.semantic.warning }]}>{copy.environmentReason[environmentOptions.data.worktreeUnavailableReason]}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={!selectedModeAllowed}
              onPress={() => changeScope(selectedProject.id, selectedMode)}
              style={({ pressed }) => [styles.primaryAction, { backgroundColor: colors.accent.primary, opacity: !selectedModeAllowed || pressed ? 0.55 : 1 }]}
            ><Text style={[styles.primaryActionText, { color: colors.accent.onPrimary }]}>{copy.startNewChat}</Text></Pressable>
          </> : null}
        </View> : null}
      </> : summary ? <>
        <Text style={[styles.sectionTitle, { color: colors.text.tertiary }]}>{copy.work}</Text>
        {summary.work.project ? <ContextRow icon="folder-outline" title={summary.work.project.title} subtitle={copy.project} /> : null}
        {summary.work.task ? <ContextRow icon="target" title={summary.work.task.title} subtitle={`${copy.task} · ${summary.work.task.phase}`} /> : null}
        {!summary.work.project && !summary.work.task ? <Text style={[styles.empty, { color: colors.text.tertiary }]}>{copy.noWork}</Text> : null}

        <View style={[styles.separator, { backgroundColor: colors.border.subtle }]} />
        <Text style={[styles.sectionTitle, { color: colors.text.tertiary }]}>{copy.environment}</Text>
        {summary.environment ? <>
          <ContextRow
            icon={summary.environment.kind === 'managed_worktree' ? 'source-branch' : 'laptop'}
            title={environmentLabel(summary.environment)!}
            subtitle={summary.environment.rootPath}
            warning={!summary.environment.available}
          />
          {summary.environment.branch || summary.environment.headSha ? <ContextRow
            icon="source-branch"
            title={summary.environment.branch || copy.detached}
            subtitle={summary.environment.headSha?.slice(0, 8)}
          /> : null}
          {!summary.environment.available ? <Text style={[styles.warning, { color: colors.semantic.warning }]}>{copy.environmentUnavailable}</Text> : null}
        </> : <Text style={[styles.empty, { color: colors.text.tertiary }]}>{copy.noEnvironment}</Text>}
        {!summary.work.project && !summary.work.task && !agentConfig.data?.workingDirectoryLocked ? <Pressable
          accessibilityRole="button"
          onPress={() => setDirectoryPath(agentConfig.data?.effectiveWorkspacePath || '')}
          style={({ pressed }) => [styles.secondaryAction, { borderColor: colors.border.default, opacity: pressed ? 0.7 : 1 }]}
        ><Text style={{ color: colors.accent.primary }}>{copy.changeFolder}</Text></Pressable> : null}

        <View style={[styles.separator, { backgroundColor: colors.border.subtle }]} />
        <Text style={[styles.sectionTitle, { color: colors.text.tertiary }]}>{copy.sources}</Text>
        {summary.sources.map((source) => <ContextRow
          key={source.id}
          icon="notebook-outline"
          title={source.title || copy.untitled}
          subtitle={source.origins.map((origin) => origin.kind === 'task' ? copy.task : copy.session).join(' · ')}
          warning={source.unavailable}
        />)}
        {draftRefs.map((ref) => <View key={`draft:${ref.sourceId}`} style={styles.row}>
          <Icon source="notebook-plus-outline" size={20} color={colors.accent.primary} />
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: colors.text.primary }]}>{ref.title}</Text>
            <Text style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>{copy.thisTurn}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${copy.remove}: ${ref.title}`} hitSlop={8} onPress={() => onRemoveDraftRef(ref.sourceId)}>
            <Icon source="close" size={18} color={colors.text.tertiary} />
          </Pressable>
        </View>)}
        {!summary.sources.length && !draftRefs.length ? <Text style={[styles.empty, { color: colors.text.tertiary }]}>{copy.noSources}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => { setOpen(false); onAddSource(); }}
          style={({ pressed }) => [styles.secondaryAction, { borderColor: colors.border.default, opacity: pressed ? 0.7 : 1 }]}
        ><Text style={{ color: colors.accent.primary }}>{copy.addSource}</Text></Pressable>
        {!summary.work.task ? <Pressable
          accessibilityRole="button"
          onPress={() => setSelecting(true)}
          style={({ pressed }) => [styles.secondaryAction, { borderColor: colors.border.default, opacity: pressed ? 0.7 : 1 }]}
        ><Text style={{ color: colors.accent.primary }}>{copy.changeScope}</Text></Pressable> : null}
      </> : null}
    </BottomSheetModal>
  </>;
});

function ModeChoice({ label, icon, selected, disabled, onPress }: {
  label: string;
  icon: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return <Pressable
    accessibilityRole="radio"
    accessibilityState={{ selected, disabled }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [styles.choice, {
      backgroundColor: selected ? colors.accent.soft : pressed ? colors.surface.pressed : colors.surface.input,
      opacity: disabled ? 0.45 : 1,
    }]}
  >
    <Icon source={icon} size={20} color={selected ? colors.accent.primary : colors.text.secondary} />
    <Text style={[styles.rowTitle, { color: colors.text.primary }]}>{label}</Text>
    {selected ? <Icon source="check" size={18} color={colors.accent.primary} /> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  strip: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  chip: { height: 30, maxWidth: 160, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, paddingHorizontal: spacing.sm },
  chipText: { ...typography.caption, flexShrink: 1 },
  contextButton: { height: 30, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
  contextButtonText: { ...typography.caption },
  sectionTitle: { ...typography.caption, marginTop: spacing.sm, marginBottom: spacing.xs, paddingHorizontal: spacing.sm },
  row: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { ...typography.body, fontWeight: '600' },
  rowSubtitle: { ...typography.caption, marginTop: spacing.xxs },
  separator: { height: StyleSheet.hairlineWidth, marginVertical: spacing.md },
  empty: { ...typography.caption, paddingHorizontal: spacing.sm, paddingVertical: spacing.md },
  warning: { ...typography.caption, paddingHorizontal: spacing.sm },
  error: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  loading: { padding: spacing.xl },
  choice: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radii.md, paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  modePanel: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.md, paddingTop: spacing.sm },
  primaryAction: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radii.lg, marginTop: spacing.md },
  primaryActionText: { ...typography.body, fontWeight: '600' },
  secondaryAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, marginTop: spacing.lg },
  directoryPath: { ...typography.caption, paddingHorizontal: spacing.sm, marginBottom: spacing.sm },
});
