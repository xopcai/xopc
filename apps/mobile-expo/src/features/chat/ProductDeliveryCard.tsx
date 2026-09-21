import type {
  ProductDeliveryEnvelope,
  ProductReferenceKind,
} from '@xopcai/gateway-contract';
import { type Href, useRouter } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { usePreferencesStore } from '../../stores/preferences-store';
import { spacing, useTheme } from '../../theme';
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
  task: { en: 'task', zh: '任务' },
  project: { en: 'project', zh: '项目' },
  note: { en: 'note', zh: '笔记' },
  workflow_definition: { en: 'workflow', zh: '工作流' },
  workflow_run: { en: 'workflow run', zh: '工作流运行' },
  automation: { en: 'automation', zh: '自动化' },
  scene: { en: 'scene', zh: '场景' },
  local_app: { en: 'local app', zh: '本地应用' },
  file: { en: 'file', zh: '文件' },
  session: { en: 'conversation', zh: '对话' },
  settings: { en: 'settings', zh: '设置' },
};

const OPERATION_LABELS = {
  created: { en: 'Created', zh: '已创建' },
  updated: { en: 'Updated', zh: '已更新' },
  opened: { en: 'Opened', zh: '已读取' },
  started: { en: 'Started', zh: '已启动' },
  completed: { en: 'Completed', zh: '已完成' },
  failed: { en: 'Failed', zh: '失败' },
} satisfies Record<ProductDeliveryEnvelope['operation'], { en: string; zh: string }>;

export const ProductDeliveryCard = memo(function ProductDeliveryCard({
  delivery,
  conversationId,
  requestAction = (action) => action(),
}: {
  delivery: ProductDeliveryEnvelope;
  conversationId?: string | null;
  requestAction?: (action: () => void) => void;
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
          : `Continue working on ${KIND_LABELS[reference.kind].en} "${reference.title}" (ID: ${reference.id}): `,
      )
      : undefined;
  const operation = OPERATION_LABELS[delivery.operation][language];

  return (
    <Pressable
      onPress={action ? () => requestAction(action) : undefined}
      disabled={!action}
      accessibilityRole={action ? 'button' : 'text'}
      accessibilityLabel={`${operation}: ${reference.title}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.surface.pressed : colors.surface.input,
          borderColor: colors.border.subtle,
        },
      ]}
    >
      <Icon source={KIND_ICONS[reference.kind]} size={18} color={colors.accent.primary} />
      <Text style={[styles.title, { color: colors.text.primary }]} numberOfLines={1}>
        {reference.title}
      </Text>
      {action ? <Icon source="chevron-right" size={18} color={colors.text.tertiary} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
  },
});
