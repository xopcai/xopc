import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionContextSummary } from '@xopcai/gateway-contract';
import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Menu, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import { fetchProjectEnvironmentOptions, fetchProjects } from '../../query/projects';
import { fetchHostDirectories } from '../../query/host-fs';
import { fetchSessionAgentConfig, setSessionWorkingDirectory } from '../../query/models';
import { fetchSessionContextSummary } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';
import type { ComposerContextRef } from './composer.types';
import { StaticLoadingIndicator } from './StaticLoadingIndicator';

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
  conversationId,
  draftRefs,
  onRemoveDraftRef,
  onAddSource,
  onChangeScope,
}: {
  conversationId: string;
  draftRefs: ComposerContextRef[];
  onRemoveDraftRef: (sourceId: string, kind: ComposerContextRef['kind']) => void;
  onAddSource: () => void;
  onChangeScope: (projectId: string | null, executionMode?: ExecutionMode) => void;
}) {
  const { colors } = useTheme();
  const m = useMessages();
  const copy = m.chat.contextCenter;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<'project' | 'environment' | null>(null);
  const [directoryPath, setDirectoryPath] = useState<string | undefined>(undefined);
  const [savingDirectory, setSavingDirectory] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const context = useQuery({
    queryKey: queryKeys.sessionContext(conversationId),
    queryFn: () => fetchSessionContextSummary(conversationId),
    enabled: Boolean(conversationId),
  });
  const projects = useQuery({
    queryKey: queryKeys.projects,
    queryFn: fetchProjects,
    enabled: menu === 'project',
  });
  const environmentOptions = useQuery({
    queryKey: ['projects', context.data?.work.project?.id ?? '', 'environment-options'],
    queryFn: () => fetchProjectEnvironmentOptions(context.data!.work.project!.id),
    enabled: menu === 'environment' && Boolean(context.data?.work.project),
  });
  const agentConfig = useQuery({
    queryKey: queryKeys.sessionAgentConfig(conversationId),
    queryFn: () => fetchSessionAgentConfig(conversationId),
    enabled: open,
  });
  const directories = useQuery({
    queryKey: ['host-directories', directoryPath ?? ''],
    queryFn: () => fetchHostDirectories(directoryPath),
    enabled: open && directoryPath !== undefined,
  });
  const changeScope = useCallback((projectId: string | null, mode?: ExecutionMode) => {
    setOpen(false);
    setMenu(null);
    onChangeScope(projectId, mode);
  }, [onChangeScope]);
  const summary = context.data;
  const chips = useMemo(() => {
    const items: Array<{ key: string; icon: string; label: string; primary?: boolean }> = [];
    items.push({ key: 'project', icon: 'folder-outline', label: summary?.work.project?.title ?? copy.chooseProject, primary: Boolean(summary?.work.project) });
    if (summary?.work.task) items.push({ key: 'task', icon: 'target', label: summary.work.task.title, primary: !summary.work.project });
    const environment = environmentLabel(summary?.environment);
    if (environment) items.push({ key: 'environment', icon: summary?.environment?.kind === 'managed_worktree' ? 'source-branch' : 'laptop', label: environment });
    const sourceCount = summary?.sources.length ?? 0;
    if (sourceCount) items.push({ key: 'sources', icon: 'notebook-outline', label: sourceCount === 1 && summary?.sources[0]?.title ? summary.sources[0].title : `${copy.sources} ${sourceCount}${summary?.sourcesHasMore ? '+' : ''}` });
    return items;
  }, [copy.sources, copy.chooseProject, summary]);

  return <>
    <View style={styles.strip}>
      {chips.map((chip) => {
        const picker = chip.key === 'project' || (chip.key === 'environment' && summary?.work.project)
          ? chip.key as 'project' | 'environment' : null;
        const trigger = <Pressable
          accessibilityState={{ busy: context.isLoading }}
          accessibilityRole="button"
          accessibilityLabel={`${chip.key === 'project' ? copy.chooseProject : chip.key === 'environment' ? copy.chooseEnvironment : copy.open}: ${chip.label}`}
          onPress={() => {
            if (picker) { setMenu(picker); return; }
            setDirectoryError(null);
            setDirectoryPath(chip.key === 'environment' && !summary?.work.task ? summary?.environment?.rootPath ?? '' : undefined);
            setOpen(true);
          }}
          style={({ pressed }) => [styles.chip, {
            backgroundColor: chip.primary ? colors.accent.soft : colors.surface.panel,
            borderColor: chip.primary ? colors.accent.soft : colors.border.subtle,
            opacity: pressed ? 0.7 : 1,
          }]}
        >
          <Icon source={chip.icon} size={15} color={chip.primary ? colors.accent.primary : colors.text.secondary} />
          <Text numberOfLines={1} style={[styles.chipText, { color: chip.primary ? colors.accent.primary : colors.text.secondary }]}>{chip.label}</Text>
        </Pressable>;
        if (!picker) return <View key={chip.key}>{trigger}</View>;
        return <Menu key={chip.key} visible={menu === picker} onDismiss={() => setMenu(null)} anchor={trigger}
          contentStyle={{ backgroundColor: colors.surface.panel, borderRadius: radii.lg }}>
          {picker === 'project' ? <>
            <Menu.Item title={copy.noProject} leadingIcon={!summary?.work.project ? 'check' : 'account-outline'}
              onPress={() => summary?.work.project || summary?.work.task ? changeScope(null) : setMenu(null)} />
            {projects.isLoading ? <StaticLoadingIndicator size={20} style={styles.loading} /> : null}
            {projects.isError ? <Menu.Item title={copy.projectsFailed} leadingIcon="refresh" onPress={() => void projects.refetch()} /> : null}
            {projects.data?.filter(project => project.status !== 'archived').map(project => (
              <Menu.Item key={project.id} title={project.name}
                leadingIcon={summary?.work.project?.id === project.id ? 'check' : 'folder-outline'}
                onPress={() => project.id === summary?.work.project?.id ? setMenu(null) : changeScope(project.id)} />
            ))}
          </> : <>
            {environmentOptions.isLoading ? <StaticLoadingIndicator size={20} style={styles.loading} /> : null}
            {environmentOptions.isError ? <Menu.Item title={copy.environmentCheckFailed} leadingIcon="refresh" onPress={() => void environmentOptions.refetch()} /> : null}
            {(['local_checkout', 'managed_worktree'] as const).map(mode => (
              <Menu.Item key={mode} title={mode === 'local_checkout' ? 'Local' : 'Worktree'}
                leadingIcon={summary?.environment?.kind === mode ? 'check' : mode === 'local_checkout' ? 'laptop' : 'source-branch'}
                disabled={environmentOptions.isError || !environmentOptions.data || (mode === 'local_checkout' ? !environmentOptions.data.localAvailable : Boolean(environmentOptions.data.worktreeUnavailableReason))}
                onPress={() => mode === summary?.environment?.kind ? setMenu(null) : changeScope(summary!.work.project!.id, mode)} />
            ))}
            {environmentOptions.data?.worktreeUnavailableReason ? <Text style={[styles.menuHint, { color: colors.text.secondary }]}>
              {copy.environmentReason[environmentOptions.data.worktreeUnavailableReason]}
            </Text> : null}
          </>}
        </Menu>;
      })}
    </View>

    <BottomSheetModal
      visible={open}
      onDismiss={() => setOpen(false)}
      title={directoryPath !== undefined ? copy.changeFolder : copy.title}
      subtitle={directoryPath !== undefined ? undefined : copy.subtitle}

      maxHeight="82%"
      scroll
      disableAnimation
    >
      {context.isError ? <View style={styles.error}>
        <Text style={{ color: colors.text.secondary }}>{copy.loadFailed}</Text>
        <Pressable onPress={() => void context.refetch()} accessibilityRole="button">
          <Text style={{ color: colors.accent.primary }}>{m.common.retry}</Text>
        </Pressable>
      </View> : null}
      {context.isLoading ? <StaticLoadingIndicator size={20} style={styles.loading} /> : null}
      {directoryPath !== undefined ? agentConfig.isLoading ? <StaticLoadingIndicator size={20} style={styles.loading} /> : agentConfig.isError ? <Pressable onPress={() => void agentConfig.refetch()}><Text>{m.common.retry}</Text></Pressable> : agentConfig.data?.workingDirectoryLocked ? <Text style={styles.empty}>{copy.folderLocked}</Text> : <>
        <Text numberOfLines={1} style={[styles.directoryPath, { color: colors.text.secondary }]}>{directories.data?.currentPath || directoryPath || copy.hostRoot}</Text>
        {directories.data?.parentPath != null ? <Pressable
          accessibilityRole="button"
          onPress={() => setDirectoryPath(directories.data!.parentPath ?? '')}
          style={({ pressed }) => [styles.choice, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.input }]}
        ><Icon source="arrow-up" size={20} color={colors.text.secondary} /><Text style={{ color: colors.text.primary }}>{copy.parentFolder}</Text></Pressable> : null}
        {directories.isLoading ? <StaticLoadingIndicator size={20} style={styles.loading} /> : null}
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
            void setSessionWorkingDirectory(conversationId, directories.data!.currentPath).then(async () => {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.sessionAgentConfig(conversationId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.sessionContext(conversationId) }),
              ]);
              setDirectoryPath(undefined);
            }).catch((error) => setDirectoryError(error instanceof Error ? error.message : String(error)))
              .finally(() => setSavingDirectory(false));
          }}
          style={({ pressed }) => [styles.primaryAction, { backgroundColor: colors.accent.primary, opacity: savingDirectory || pressed ? 0.65 : 1 }]}
        ><Text style={[styles.primaryActionText, { color: colors.accent.onPrimary }]}>{copy.useFolder}</Text></Pressable> : null}
        {directoryError ? <Text style={[styles.warning, { color: colors.semantic.error }]}>{directoryError}</Text> : null}
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
        {draftRefs.map((ref) => <View key={`draft:${ref.kind}:${ref.sourceId}`} style={styles.row}>
          <Icon source={ref.kind === 'task' ? 'checkbox-marked-circle-outline' : 'notebook-plus-outline'} size={20} color={colors.accent.primary} />
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: colors.text.primary }]}>{ref.title}</Text>
            <Text style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>{copy.thisTurn}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${copy.remove}: ${ref.title}`} hitSlop={8} onPress={() => onRemoveDraftRef(ref.sourceId, ref.kind)}>
            <Icon source="close" size={18} color={colors.text.tertiary} />
          </Pressable>
        </View>)}
        {!summary.sources.length && !draftRefs.length ? <Text style={[styles.empty, { color: colors.text.tertiary }]}>{copy.noSources}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => { setOpen(false); onAddSource(); }}
          style={({ pressed }) => [styles.secondaryAction, { borderColor: colors.border.default, opacity: pressed ? 0.7 : 1 }]}
        ><Text style={{ color: colors.accent.primary }}>{copy.addSource}</Text></Pressable>

      </> : null}
    </BottomSheetModal>
  </>;
});

const styles = StyleSheet.create({
  strip: { minHeight: 44, backgroundColor: 'transparent', flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chip: { minHeight: 44, maxWidth: 160, flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.full, paddingHorizontal: spacing.sm },
  chipText: { ...typography.caption, flexShrink: 1 },
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
  menuHint: { ...typography.caption, maxWidth: 280, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  primaryAction: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radii.lg, marginTop: spacing.md },
  primaryActionText: { ...typography.body, fontWeight: '600' },
  secondaryAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, marginTop: spacing.lg },
  directoryPath: { ...typography.caption, paddingHorizontal: spacing.sm, marginBottom: spacing.sm },
});
