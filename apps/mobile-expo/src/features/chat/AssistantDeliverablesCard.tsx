import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import type { AssistantDeliverables } from './assistant-deliverables';
import { AttachmentRenderer } from './AttachmentRenderer';
import { ProductDeliveryCard } from './ProductDeliveryCard';
import { WorkspaceArtifactStrip } from './WorkspaceArtifactStrip';
import { useMessages } from '../../i18n/messages';
import { typography, useTheme } from '../../theme';

export const AssistantDeliverablesCard = memo(function AssistantDeliverablesCard({
  deliverables,
  sessionKey,
}: {
  deliverables: AssistantDeliverables;
  sessionKey?: string | null;
}) {
  const { colors } = useTheme();
  const m = useMessages();
  const hasContent = deliverables.workspacePaths.length > 0
    || deliverables.attachments.length > 0
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
        {deliverables.workspacePaths.length > 0 ? (
          <WorkspaceArtifactStrip paths={deliverables.workspacePaths} sessionKey={sessionKey} />
        ) : null}
        {deliverables.attachments.length > 0 ? (
          <AttachmentRenderer attachments={deliverables.attachments} sessionKey={sessionKey} compact />
        ) : null}
        {deliverables.productDeliveries.map((delivery) => (
          <ProductDeliveryCard
            key={`${delivery.operation}:${delivery.primary?.kind ?? 'none'}:${delivery.primary?.id ?? 'none'}`}
            delivery={delivery}
            sessionKey={sessionKey}
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
