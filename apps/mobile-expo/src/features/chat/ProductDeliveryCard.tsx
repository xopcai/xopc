import type {
  ProductDeliveryEnvelope,
  ProductReferenceKind,
} from '@xopcai/gateway-contract';
import { type Href, useRouter } from 'expo-router';
import { memo, useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { radii, spacing, useTheme } from '../../theme';
import { usePreferencesStore } from '../../stores/preferences-store';
import type { ShareAutoRequest } from '../../api/share';
import { ShareSheet } from '../share/ShareSheet';
import { dispatchMobileComposerFill } from './mobile-composer-fill';
import {
  MOBILE_NATIVE_PRODUCT_KINDS,
  mobileProductRoute,
} from './product-delivery';

const KIND_ICONS: Record<ProductReferenceKind, string> = {
  task: 'target',
  project: 'folder-outline',
  note: 'notebook-outline',
  workflow_definition: 'source-branch',
  workflow_run: 'play-circle-outline',
  automation: 'robot-outline',
  local_app: 'application-outline',
  file: 'file-outline',
  session: 'message-text-outline',
  settings: 'cog-outline',
};

const KIND_LABELS: Record<ProductReferenceKind, { en: string; zh: string }> = {
  task: { en: 'Task', zh: '结果' },
  project: { en: 'Project', zh: '项目' },
  note: { en: 'Note', zh: '笔记' },
  workflow_definition: { en: 'Workflow', zh: '工作流' },
  workflow_run: { en: 'Workflow run', zh: '工作流运行' },
  automation: { en: 'Automation', zh: '自动化' },
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

export const ProductDeliveryCard = memo(function ProductDeliveryCard({
  delivery,
  sessionKey,
}: {
  delivery: ProductDeliveryEnvelope;
  sessionKey?: string | null;
}) {
  const reference = delivery.primary;
  const router = useRouter();
  const language = usePreferencesStore((state) => state.language);
  const { colors } = useTheme();
  const [shareRequest, setShareRequest] = useState<ShareAutoRequest | null>(null);
  if (!reference) return null;

  const hasNativeDestination = MOBILE_NATIVE_PRODUCT_KINDS.has(reference.kind);
  const destination = mobileProductRoute(reference);
  const canOpen = reference.capabilities.includes('open') && destination !== null;
  const canContinue = reference.capabilities.includes('continue_in_chat');
  const canShare = reference.capabilities.includes('share');
  const fileShareRequest: ShareAutoRequest | null = (
    reference.kind === 'file' && canShare
      ? {
          path: reference.id,
          sessionKey: sessionKey || undefined,
          title: reference.title,
          description: reference.summary,
        }
      : null
  );
  const statusText = [
    OPERATION_LABELS[delivery.operation][language],
    reference.status,
  ].filter(Boolean).join(' · ');

  const open = () => {
    if (destination) router.push(destination as Href);
  };
  const continueInChat = () => {
    const text = language === 'zh'
      ? `继续处理${KIND_LABELS[reference.kind].zh}「${reference.title}」（ID: ${reference.id}）：`
      : `Continue working on ${KIND_LABELS[reference.kind].en.toLowerCase()} "${reference.title}" (ID: ${reference.id}): `;
    dispatchMobileComposerFill(text);
  };
  const share = () => {
    if (fileShareRequest) {
      setShareRequest(fileShareRequest);
      return;
    }
    void Share.share({
      title: reference.title,
      message: [reference.title, reference.summary].filter(Boolean).join('\n\n'),
    }).catch(() => undefined);
  };

  return (
    <>
      <View
      style={[
        styles.container,
        {
          borderColor: colors.border.subtle,
          backgroundColor: colors.surface.panel,
        },
      ]}
    >
      <Pressable
        style={styles.body}
        onPress={canOpen ? open : undefined}
        accessibilityRole={canOpen ? 'button' : 'summary'}
        accessibilityLabel={`${reference.title}, ${statusText}`}
      >
        <View style={[styles.icon, { backgroundColor: colors.accent.soft }]}>
          <Icon source={KIND_ICONS[reference.kind]} size={19} color={colors.accent.primary} />
        </View>
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text variant="titleSmall" numberOfLines={1} style={styles.title}>
              {reference.title}
            </Text>
            <View style={[styles.kindPill, { borderColor: colors.border.subtle }]}>
              <Text variant="labelSmall" style={{ color: colors.text.secondary }}>
                {KIND_LABELS[reference.kind][language]}
              </Text>
            </View>
          </View>
          <Text variant="bodySmall" style={{ color: colors.text.secondary }}>
            {statusText}
          </Text>
          {reference.summary ? (
            <Text
              variant="bodySmall"
              numberOfLines={2}
              style={[styles.summary, { color: colors.text.tertiary }]}
            >
              {reference.summary}
            </Text>
          ) : null}
          {!hasNativeDestination && reference.capabilities.includes('open') ? (
            <Text variant="labelSmall" style={[styles.fallback, { color: colors.text.tertiary }]}>
              {language === 'zh' ? '移动端暂未提供详情页，可继续在对话中处理' : 'Continue in chat to work with this item'}
            </Text>
          ) : null}
        </View>
        {canOpen ? <Icon source="chevron-right" size={18} color={colors.text.tertiary} /> : null}
      </Pressable>
      {canOpen || canContinue || canShare ? (
        <View style={[styles.actions, { borderTopColor: colors.border.subtle }]}>
          {canShare ? (
            <Pressable
              style={styles.action}
              onPress={share}
              accessibilityRole="button"
              accessibilityLabel={language === 'zh' ? '分享结果' : 'Share result'}
            >
              <Text variant="labelMedium" style={{ color: colors.accent.primary }}>
                {language === 'zh' ? '分享' : 'Share'}
              </Text>
            </Pressable>
          ) : null}
          {canContinue ? (
            <Pressable
              style={styles.action}
              onPress={continueInChat}
              accessibilityRole="button"
              accessibilityLabel={language === 'zh' ? '在对话中继续处理结果' : 'Continue working on result in chat'}
            >
              <Text variant="labelMedium" style={{ color: colors.accent.primary }}>
                {language === 'zh' ? '在对话中继续' : 'Continue in chat'}
              </Text>
            </Pressable>
          ) : null}
          {canOpen ? (
            <Pressable
              style={styles.action}
              onPress={open}
              accessibilityRole="button"
              accessibilityLabel={language === 'zh' ? '打开结果' : 'Open result'}
            >
              <Text variant="labelMedium" style={{ color: colors.accent.primary }}>
                {language === 'zh' ? '打开' : 'Open'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      </View>
      <ShareSheet
        visible={Boolean(shareRequest)}
        request={shareRequest}
        onClose={() => setShareRequest(null)}
      />
    </>
  );
});

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  titleRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    minWidth: 0,
    flexShrink: 1,
    fontWeight: '600',
  },
  kindPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  summary: {
    marginTop: 3,
    lineHeight: 17,
  },
  fallback: {
    marginTop: 4,
  },
  actions: {
    minHeight: 40,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
});
