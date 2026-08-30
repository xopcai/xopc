import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import { fetchProject } from '../../query/projects';
import { fetchTask } from '../../query/tasks';
import { useTheme } from '../../theme';

type ChatContextBannerProps = {
  projectId?: string;
  taskId?: string;
  onRemoveProject?: () => void;
};

export const ChatContextBanner = memo(function ChatContextBanner({
  projectId,
  taskId,
  onRemoveProject,
}: ChatContextBannerProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const m = useMessages();
  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId ?? ''),
    queryFn: () => fetchProject(projectId!),
    enabled: Boolean(projectId),
  });
  const taskQuery = useQuery({
    queryKey: queryKeys.task(taskId ?? ''),
    queryFn: () => fetchTask(taskId!),
    enabled: Boolean(taskId),
  });

  const openContext = useCallback(() => {
    if (taskId) {
      router.push(`/tasks/${encodeURIComponent(taskId)}`);
    } else if (projectId) {
      router.push(`/projects/${encodeURIComponent(projectId)}`);
    }
  }, [projectId, router, taskId]);

  if (!projectId && !taskId) return null;

  const taskTitle = taskQuery.data?.task.title?.trim();
  const projectTitle = projectQuery.data?.name?.trim();
  const label = taskId ? m.chat.contextTaskLabel : m.chat.contextProjectLabel;
  const title = taskId ? taskTitle || label : projectTitle || label;
  const subtitle = taskId && projectTitle
    ? `${projectTitle} · ${m.chat.contextActive}`
    : m.chat.contextActive;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${m.chat.openContext}: ${title}`}
      onPress={openContext}
      style={({ pressed }) => [
        styles.banner,
        {
          backgroundColor: pressed ? colors.surface.pressed : colors.accent.soft,
          borderColor: colors.border.subtle,
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.surface.panel }]}>
        <Icon
          source={taskId ? 'clipboard-text-outline' : 'folder-outline'}
          size={19}
          color={colors.accent.primary}
        />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: colors.accent.primary }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.title, { color: colors.text.primary }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.subtitle, { color: colors.text.secondary }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
      {projectId && !taskId && onRemoveProject ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={m.chat.removeProjectContext}
          hitSlop={8}
          onPress={(event) => {
            event.stopPropagation();
            onRemoveProject();
          }}
          style={styles.removeButton}
        >
          <Icon source="close" size={18} color={colors.text.tertiary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  removeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 30,
  },
  banner: {
    minHeight: 64,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  title: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
});
