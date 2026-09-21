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
import { typography, useTheme } from '../../theme';

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

export const AssistantDeliverablesCard = memo(function AssistantDeliverablesCard({
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
  if (!hasContent && !deliverables.awaiting) return null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: 'transparent', borderColor: colors.border.default },
      ]}
    >
      <Text style={[styles.title, { color: colors.text.secondary }]}>
        {m.chat.messageArtifactsHeading}
      </Text>
      <View style={styles.body}>
        {deliverables.awaiting && !hasContent ? (
          <View style={styles.skeletonRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[styles.skeletonThumb, { backgroundColor: colors.surface.input }]} />
            <View style={styles.skeletonText}>
              <View style={[styles.skeletonLineWide, { backgroundColor: colors.surface.input }]} />
              <View style={[styles.skeletonLineNarrow, { backgroundColor: colors.surface.input }]} />
            </View>
          </View>
        ) : null}
        {attachments.length > 0 ? (
          <AttachmentRenderer attachments={attachments} conversationId={conversationId} />
        ) : null}
        <CompactResourceList
          items={secondaryArtifacts}
          title={m.chat.messageArtifactsHeading}
          moreLabel={(count) => m.chat.moreArtifacts.replace('{{count}}', String(count))}
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
                  { backgroundColor: pressed ? colors.surface.pressed : colors.surface.input },
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
                <Text style={[styles.artifactTitle, { color: colors.text.primary }]} numberOfLines={1}>
                  {artifact.title}
                </Text>
                {canOpen ? <Icon source="chevron-right" size={18} color={colors.text.tertiary} /> : null}
              </Pressable>
            );
          }}
        />
        <CompactResourceList
          items={deliverables.productDeliveries}
          title={m.chat.messageArtifactsHeading}
          moreLabel={(count) => m.chat.moreArtifacts.replace('{{count}}', String(count))}
          keyExtractor={(delivery) => `${delivery.primary?.kind ?? 'none'}:${delivery.primary?.id ?? 'none'}`}
          renderItem={(delivery, _index, requestAction) => (
            <ProductDeliveryCard
              delivery={delivery}
              conversationId={conversationId}
              requestAction={requestAction}
            />
          )}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    paddingVertical: 12,
    marginTop: 10,
    gap: 8,
  },
  title: {
    ...typography.label,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  body: {
    gap: 8,
  },
  artifactRow: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  artifactTitle: {
    minWidth: 0,
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  skeletonRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  skeletonThumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
  },
  skeletonText: {
    flex: 1,
    gap: 8,
  },
  skeletonLineWide: {
    width: '68%',
    height: 10,
    borderRadius: 5,
  },
  skeletonLineNarrow: {
    width: '38%',
    height: 10,
    borderRadius: 5,
  },
});
