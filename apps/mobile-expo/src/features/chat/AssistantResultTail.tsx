import type { TurnOutcomeDeliverable } from '@xopcai/gateway-contract';
import { memo } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import type { AssistantDeliverables } from './assistant-deliverables';
import { AttachmentRenderer } from './AttachmentRenderer';
import { CompactResourceList } from './CompactResourceList';
import type { MessageAttachment } from './messages.types';
import { ProductDeliveryCard } from './ProductDeliveryCard';
import { useMessages } from '../../i18n/messages';
import { radii, spacing, typography, useTheme } from '../../theme';

function attachmentFromArtifact(artifact: TurnOutcomeDeliverable): MessageAttachment | null {
  if (artifact.availability !== 'available' || !artifact.uri) return null;
  return {
    id: artifact.artifactId,
    name: artifact.title,
    type: artifact.kind,
    mimeType: artifact.mimeType,
    size: artifact.sizeBytes,
    uri: artifact.uri,
    workspaceRelativePath: artifact.workspaceRelativePath,
  };
}

function unavailableLabel(
  artifact: TurnOutcomeDeliverable,
  labels: {
    materializing: string;
    expired: string;
    missing: string;
    failed: string;
    unavailable: string;
  },
): string {
  if (artifact.availability === 'materializing') return labels.materializing;
  if (artifact.availability === 'expired') return labels.expired;
  if (artifact.availability === 'missing') return labels.missing;
  if (artifact.availability === 'failed') return labels.failed;
  return labels.unavailable;
}

export const AssistantResultTail = memo(function AssistantResultTail({
  deliverables,
  conversationId,
}: {
  deliverables: AssistantDeliverables;
  conversationId?: string | null;
}) {
  const { colors } = useTheme();
  const m = useMessages();
  const attachments = deliverables.artifacts
    .map(attachmentFromArtifact)
    .filter((item): item is MessageAttachment => item !== null);
  const links = deliverables.artifacts.filter(
    (artifact) => artifact.availability === 'available' && !artifact.uri && Boolean(artifact.shareUrl),
  );
  const unavailable = deliverables.artifacts.filter(
    (artifact) => artifact.availability !== 'available' || (!artifact.uri && !artifact.shareUrl),
  );
  const secondaryArtifacts = [...links, ...unavailable];
  const hasContent = deliverables.artifacts.length > 0
    || deliverables.productDeliveries.length > 0;
  if (!hasContent) return null;

  return (
    <View style={styles.shell} accessibilityLabel={m.chat.messageArtifactsHeading}>
      <View
        pointerEvents="none"
        style={[styles.pointer, { backgroundColor: colors.surface.input }]}
      />
      <View style={[styles.card, { backgroundColor: colors.surface.input }]}>
        {attachments.length > 0 ? (
          <AttachmentRenderer
            attachments={attachments}
            conversationId={conversationId}
            embedded
          />
        ) : null}
        <CompactResourceList
          items={secondaryArtifacts}
          title={m.chat.messageArtifactsHeading}
          moreLabel={(count) => m.chat.moreArtifacts.replace('{{count}}', String(count))}
          embedded
          keyExtractor={(artifact) => artifact.artifactId}
          renderItem={(artifact, _index, requestAction) => {
            const canOpen = artifact.availability === 'available' && Boolean(artifact.shareUrl);
            const status = canOpen ? null : unavailableLabel(artifact, {
              materializing: m.chat.artifactMaterializing,
              expired: m.chat.artifactExpired,
              missing: m.chat.artifactMissing,
              failed: m.chat.artifactFailed,
              unavailable: m.chat.artifactUnavailable,
            });
            return (
              <Pressable
                disabled={!canOpen}
                style={({ pressed }) => [
                  styles.artifactRow,
                  { backgroundColor: pressed ? colors.surface.pressed : 'transparent' },
                ]}
                onPress={canOpen
                  ? () => requestAction(() => void Linking.openURL(artifact.shareUrl!))
                  : undefined}
                accessibilityRole={canOpen ? 'link' : 'text'}
                accessibilityLabel={status ? `${artifact.title}. ${status}` : artifact.title}
              >
                <Icon
                  source={canOpen ? 'open-in-new' : 'file-alert-outline'}
                  size={18}
                  color={colors.text.secondary}
                />
                <View style={styles.artifactCopy}>
                  <Text style={[styles.artifactTitle, { color: colors.text.primary }]} numberOfLines={1}>
                    {artifact.title}
                  </Text>
                  {status ? (
                    <Text style={[styles.artifactMeta, { color: colors.text.secondary }]} numberOfLines={1}>
                      {status}
                    </Text>
                  ) : null}
                </View>
                {canOpen ? <Icon source="chevron-right" size={18} color={colors.text.tertiary} /> : null}
              </Pressable>
            );
          }}
        />
        <CompactResourceList
          items={deliverables.productDeliveries}
          title={m.chat.messageArtifactsHeading}
          moreLabel={(count) => m.chat.moreArtifacts.replace('{{count}}', String(count))}
          embedded
          keyExtractor={(delivery) => `${delivery.primary?.kind ?? 'none'}:${delivery.primary?.id ?? 'none'}`}
          renderItem={(delivery, _index, requestAction) => (
            <ProductDeliveryCard
              delivery={delivery}
              conversationId={conversationId}
              requestAction={requestAction}
              embedded
            />
          )}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  shell: {
    alignSelf: 'flex-start',
    width: '88%',
    maxWidth: 420,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    paddingBottom: spacing.xs,
  },
  pointer: {
    position: 'absolute',
    left: spacing.md,
    bottom: 1,
    width: spacing.md,
    height: spacing.md,
    borderRadius: spacing.xxs,
    transform: [{ rotate: '45deg' }],
  },
  card: {
    borderRadius: radii.lg,
    padding: spacing.xs,
    gap: spacing.xs,
    overflow: 'hidden',
  },
  artifactRow: {
    minHeight: 56,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  artifactCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  artifactTitle: {
    ...typography.ui,
    fontWeight: '600',
  },
  artifactMeta: {
    ...typography.caption,
  },
});
