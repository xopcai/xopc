import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { useMessages } from '../../i18n/messages';
import { recordingNoteOptions } from '../../query/recordings';
import { useGatewayStore } from '../../stores/gateway-store';
import { spacing, typography, useTheme } from '../../theme';

/** Read-only recording data must never be merged into the editable note draft. */
export function RecordingNoteSections({ noteId }: { noteId: string }) {
  const m = useMessages();
  const { colors } = useTheme();
  const profile = useGatewayStore(state => state.getActiveProfile());
  const detail = useQuery(recordingNoteOptions(noteId, profile ? {
    gatewayId: profile.gatewayId, deviceId: profile.deviceId, publicKey: profile.gatewayPublicKey,
  } : undefined));
  if (!profile) return null;
  if (detail.isLoading) return <ListSkeleton count={2} withIcon={false} />;
  if (detail.isError) return <View style={styles.section}>
    <Text accessibilityRole="alert" style={{ color: colors.text.secondary }}>{m.recordings.error}</Text>
    <Button onPress={() => void detail.refetch()}>{m.common.retry}</Button>
  </View>;
  if (!detail.data) return null;
  const { discussion, transcript, organization } = detail.data;
  const summary = organization?.organization;
  const text = transcript.text || discussion.canonicalTranscript;
  const pending = !['completed', 'cancelled', 'needs_attention'].includes(discussion.status);
  return <View style={[styles.section, { borderBottomColor: colors.border.subtle }]}>
    {pending && <Text accessibilityLiveRegion="polite" style={{ color: colors.text.secondary }}>{m.recordings.processing}</Text>}
    {discussion.status === 'needs_attention' && <Text accessibilityRole="alert" style={{ color: colors.text.secondary }}>{m.recordings.processingFailed}</Text>}
    {summary && <>
      <Text style={[styles.heading, { color: colors.text.primary }]}>{m.recordings.summary}</Text>
      <Text selectable style={[styles.body, { color: colors.text.primary }]}>{summary.summary}</Text>
      {summary.keyPoints.map((point, index) => <Text selectable key={index} style={[styles.body, { color: colors.text.primary }]}>• {point}</Text>)}
      {!!summary.decisions.length && <Text style={styles.heading}>{m.recordings.decisions}</Text>}
      {summary.decisions.map(decision => <Text selectable key={decision.id} style={styles.body}>• {decision.text}</Text>)}
      {summary.actionItems.some(item => !item.ignored) && <Text style={styles.heading}>{m.recordings.actions}</Text>}
      {summary.actionItems.filter(item => !item.ignored).map(item => <Text selectable key={item.id} style={styles.body}>• {item.title}{item.owner ? ` · ${item.owner}` : ''}</Text>)}
    </>}
    <Text style={[styles.heading, { color: colors.text.primary }]}>{m.recordings.transcript}</Text>
    <Text selectable style={[styles.body, { color: text ? colors.text.primary : colors.text.secondary }]}>{text || m.recordings.transcriptEmpty}</Text>
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.xl, paddingBottom: spacing.xl, gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  heading: { ...typography.title },
  body: { ...typography.body },
});
