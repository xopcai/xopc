import type { TurnOutcomeDeliverable } from '@xopcai/gateway-contract';
import { memo } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import type { AssistantDeliverables } from './assistant-deliverables';
import { AttachmentRenderer } from './AttachmentRenderer';
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
  sessionKey,
}: {
  deliverables: AssistantDeliverables;
  sessionKey?: string | null;
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
  const hasContent = deliverables.artifacts.length > 0
    || deliverables.productDeliveries.length > 0;
  if (!hasContent && !deliverables.awaiting) return null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface.panel, borderColor: colors.border.default },
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
          <AttachmentRenderer attachments={attachments} sessionKey={sessionKey} compact />
        ) : null}
        {links.map((artifact) => (
          <Pressable
            key={artifact.artifactId}
            style={({ pressed }) => [
              styles.artifactRow,
              { backgroundColor: colors.surface.input },
              pressed && styles.pressed,
            ]}
            onPress={() => void Linking.openURL(artifact.shareUrl!)}
            accessibilityRole="link"
            accessibilityLabel={artifact.title}
          >
            <Icon source="open-in-new" size={16} color={colors.text.secondary} />
            <Text style={[styles.artifactTitle, { color: colors.text.primary }]} numberOfLines={1}>
              {artifact.title}
            </Text>
          </Pressable>
        ))}
        {unavailable.map((artifact) => {
          const status = unavailableLabel(artifact, {
            materializing: m.chat.artifactMaterializing,
            expired: m.chat.artifactExpired,
            missing: m.chat.artifactMissing,
            failed: m.chat.artifactFailed,
            unavailable: m.chat.artifactUnavailable,
          });
          return (
            <View
              key={artifact.artifactId}
              style={[styles.artifactRow, { backgroundColor: colors.surface.input }]}
              accessibilityLabel={`${artifact.title}. ${status}`}
            >
              <Icon source="file-alert-outline" size={16} color={colors.text.secondary} />
              <View style={styles.artifactText}>
                <Text style={[styles.artifactTitle, { color: colors.text.primary }]} numberOfLines={1}>
                  {artifact.title}
                </Text>
                <Text style={[styles.artifactStatus, { color: colors.text.secondary }]} numberOfLines={1}>
                  {status}
                </Text>
              </View>
            </View>
          );
        })}
        {deliverables.productDeliveries.map((delivery) => (
          <ProductDeliveryCard
            key={`${delivery.operation}:${delivery.primary?.kind ?? 'none'}:${delivery.primary?.id ?? 'none'}`}
            delivery={delivery}
          />
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    gap: 8,
  },
  title: {
    ...typography.micro,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  body: {
    gap: 8,
  },
  artifactRow: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  artifactText: {
    minWidth: 0,
    flex: 1,
  },
  artifactTitle: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
  },
  artifactStatus: {
    fontSize: 11,
    lineHeight: 15,
  },
  pressed: {
    opacity: 0.72,
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
