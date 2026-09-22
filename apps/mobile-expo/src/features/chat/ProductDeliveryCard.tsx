import type {
  ProductDeliveryEnvelope,
  ProductReferenceKind,
} from '@xopcai/gateway-contract';
import { type Href, useRouter } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { usePreferencesStore } from '../../stores/preferences-store';
import { radii, spacing, typography, useTheme } from '../../theme';
import { dispatchMobileComposerFill } from './mobile-composer-fill';
import { mobileProductRoute } from './product-delivery';

const KIND_ICONS: Record<ProductReferenceKind, string> = {
  task: 'target',
  project: 'folder-outline',
  note: 'notebook-outline',
  workflow_definition: 'source-branch',
  workflow_run: 'play-circle-outline',
  automation: 'robot-outline',
  scene: 'view-dashboard-outline',
  local_app: 'application-outline',
  file: 'file-outline',
  session: 'message-text-outline',
  settings: 'cog-outline',
};

const KIND_LABELS: Record<ProductReferenceKind, { en: string; zh: string }> = {
  task: { en: 'Task', zh: '任务' },
  project: { en: 'Project', zh: '项目' },
  note: { en: 'Note', zh: '笔记' },
  workflow_definition: { en: 'Workflow', zh: '工作流' },
  workflow_run: { en: 'Workflow run', zh: '工作流运行' },
  automation: { en: 'Automation', zh: '自动化' },
  scene: { en: 'Scene', zh: '场景' },
  local_app: { en: 'Local app', zh: '本地应用' },
  file: { en: 'File', zh: '文件' },
  session: { en: 'Conversation', zh: '对话' },
  settings: { en: 'Settings', zh: '设置' },
};

const OPERATION_LABELS = {
  created: { en: 'Created', zh: '已创建' },
  updated: { en: 'Updated', zh: '已更新' },
  opened: { en: 'Ready', zh: '已就绪' },
  started: { en: 'Started', zh: '已启动' },
  completed: { en: 'Completed', zh: '已完成' },
  failed: { en: 'Failed', zh: '失败' },
} satisfies Record<ProductDeliveryEnvelope['operation'], { en: string; zh: string }>;

const STATUS_LABELS: Record<string, { en: string; zh: string }> = {
  active: { en: 'Active', zh: '运行中' },
  completed: { en: 'Completed', zh: '已完成' },
  disabled: { en: 'Disabled', zh: '已停用' },
  enabled: { en: 'Enabled', zh: '已启用' },
  failed: { en: 'Failed', zh: '失败' },
  inbox: { en: 'Inbox', zh: '收件箱' },
  paused: { en: 'Paused', zh: '已暂停' },
  ready: { en: 'Ready', zh: '已就绪' },
  running: { en: 'Running', zh: '运行中' },
};

export const ProductDeliveryCard = memo(function ProductDeliveryCard({
  delivery,
  conversationId,
  requestAction = (action) => action(),
  embedded = false,
}: {
  delivery: ProductDeliveryEnvelope;
  conversationId?: string | null;
  requestAction?: (action: () => void) => void;
  embedded?: boolean;
}) {
  const reference = delivery.primary;
  const router = useRouter();
  const language = usePreferencesStore((state) => state.language);
  const { colors } = useTheme();
  if (!reference) return null;

  const destination = mobileProductRoute(reference);
  const canOpen = reference.capabilities.includes('open') && destination !== null;
  const canContinue = Boolean(conversationId) && reference.capabilities.includes('continue_in_chat');
  const action = canOpen
    ? () => router.push((reference.kind === 'file' && conversationId
      ? `${destination}?conversationId=${encodeURIComponent(conversationId)}`
      : destination) as Href)
    : canContinue
      ? () => dispatchMobileComposerFill(
        conversationId!,
        language === 'zh'
          ? `继续处理${KIND_LABELS[reference.kind].zh}「${reference.title}」（ID: ${reference.id}）：`
          : `Continue working on ${KIND_LABELS[reference.kind].en.toLowerCase()} "${reference.title}" (ID: ${reference.id}): `,
      )
      : undefined;
  const operation = OPERATION_LABELS[delivery.operation][language];
  const rawStatus = reference.status?.trim();
  const status = rawStatus ? STATUS_LABELS[rawStatus.toLowerCase()]?.[language] ?? rawStatus : null;
  const state = status && delivery.operation === 'opened'
    ? status
    : status && status.toLowerCase() !== operation.toLowerCase()
      ? `${operation} · ${status}`
      : status ?? operation;
  const meta = `${KIND_LABELS[reference.kind][language]} · ${state}`;

  return (
    <Pressable
      onPress={action ? () => requestAction(action) : undefined}
      disabled={!action}
      accessibilityRole={action ? 'button' : 'text'}
      accessibilityLabel={`${reference.title}. ${meta}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed
            ? colors.surface.pressed
            : embedded ? 'transparent' : colors.surface.input,
          borderColor: embedded ? 'transparent' : colors.border.subtle,
        },
      ]}
    >
      <Icon source={KIND_ICONS[reference.kind]} size={18} color={colors.accent.primary} />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text.primary }]} numberOfLines={1}>
          {reference.title}
        </Text>
        <Text style={[styles.meta, { color: colors.text.secondary }]} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {action ? <Icon source="chevron-right" size={18} color={colors.text.tertiary} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...typography.ui,
    fontWeight: '600',
  },
  meta: {
    ...typography.caption,
  },
});
