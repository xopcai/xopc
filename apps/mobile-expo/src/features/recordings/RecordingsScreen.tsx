import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { BatchActionBar } from '../../components/BatchActionBar';
import { ListSkeleton } from '../../components/ListSkeleton';
import { ListSelectionCheckbox } from '../../components/ListSelectionCheckbox';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { SwipeableRow } from '../../components/SwipeableRow';
import { LIST_DELAY_LONG_PRESS } from '../../constants/list-interaction';
import { useListSelection } from '../../hooks/use-list-selection';
import { useMessages } from '../../i18n/messages';
import { noteDetailRoute } from '../../lib/navigation';
import { recordingDetailOptions, retryRecording, uploadRecording } from '../../query/recordings';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, spacing, useTheme } from '../../theme';
import { finishRecording, recordingAvailable, startRecording, useRecordings, type LocalRecording } from './recordings';

export function RecordingsScreen() {
  const router = useRouter();
  const m = useMessages().recordings;
  const { colors } = useTheme();
  const client = useQueryClient();
  const items = useRecordings(state => state.items);
  const list = useRef<FlatList<LocalRecording>>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const selectRecording = (id: string) => { setSelectedId(id); list.current?.scrollToOffset({ offset: 0, animated: true }); };
  const [progress, setProgress] = useState('');
  const selected = items.find(item => item.id === selectedId) ?? items[0];
  const profile = useGatewayStore(state => state.getActiveProfile());
  const matchesWorkspace = !selected?.binding || !!profile && selected.binding.gatewayId === profile.gatewayId
    && selected.binding.deviceId === profile.deviceId && selected.binding.publicKey === profile.gatewayPublicKey;
  const detail = useQuery(recordingDetailOptions(matchesWorkspace ? selected : undefined));
  const selection = useListSelection<string>();
  const action = useMutation({ mutationFn: async (run: () => Promise<unknown>) => run(), onSettled: () => {
    setProgress('');
    void client.invalidateQueries({ queryKey: ['recording-detail'] });
  } });
  const run = (fn: () => Promise<unknown>) => action.mutate(fn);
  const sync = async (item: LocalRecording) => uploadRecording(item, (done, total) => setProgress(`${m.uploading} ${done}/${total}`));
  const button = (label: string, fn: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || action.isPending} onPress={fn}
      style={[styles.button, { backgroundColor: colors.surface.panel, opacity: disabled || action.isPending ? 0.5 : 1 }]}>
      <Text style={{ color: colors.accent.primary }}>{label}</Text>
    </Pressable>
  );
  const error = action.error || detail.error;
  const errorCode = error instanceof Error ? error.message : '';
  const errorText = errorCode.includes('PERMISSION_DENIED') ? m.permission
    : errorCode.includes('BUSY') ? m.busy : errorCode.includes('RECORDING_EMPTY') ? m.emptyAudio
      : errorCode.includes('RECORDING_WORKSPACE_CHANGED') ? (profile ? m.workspaceChanged : m.connect) : m.error;
  const organization = detail.data?.organization?.organization;
  const status = detail.data?.discussion.status;
  return <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
    <NativeScreenHeader title={m.title} onBack={selection.selectionMode ? selection.exitSelectionMode : () => router.back()} />
    <FlatList ref={list} data={items} keyExtractor={item => item.id} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.panel}>
        <Text style={{ color: colors.text.secondary }}>{m.disclosure}</Text>
        {!recordingAvailable && <Text>{m.nativeBuildRequired}</Text>}
        {button(m.start, () => run(async () => { const item = await startRecording({ title: m.title, stop: m.finish }); selectRecording(item.id); }),
          !recordingAvailable || items.some(item => item.state === 'recording' || item.state === 'paused'))}
        {selected && <View style={styles.panel}>
          <Text variant="titleMedium">{new Date(selected.recordedAt).toLocaleString()}</Text>
          <Text>{m[selected.state]}</Text>
          {selected.durationMs !== undefined && <Text>{m.duration}: {Math.floor(selected.durationMs / 60000)}:{String(Math.floor(selected.durationMs / 1000) % 60).padStart(2, '0')}</Text>}
          {selected.state === 'recording' && button(m.pause, () => run(() => finishRecording(selected, true)))}
          {selected.state === 'paused' && button(m.resume, () => run(() => startRecording({ title: m.title, stop: m.finish }, selected)))}
          {selected.state !== 'saved' && button(m.finish, () => run(() => finishRecording(selected)))}
          {!matchesWorkspace && <Text>{m.workspaceChanged}</Text>}
          {detail.isLoading && <ListSkeleton count={2} withIcon={false} />}
          {selected.state === 'saved' && !selected.discussionId && button(m.upload, () => run(() => sync(selected)), !matchesWorkspace)}
          {selected.state === 'saved' && selected.discussionId && !detail.isLoading && !detail.data?.recordingJob && button(m.upload, () => run(() => sync(selected)), !matchesWorkspace)}
          {detail.data?.recordingJob?.state === 'failed' && button(m.upload, () => run(() => sync(selected)), !matchesWorkspace)}
          {status === 'needs_attention' && detail.data?.recordingJob?.state !== 'failed' && button(m.retry, () => run(() => retryRecording(selected)), !matchesWorkspace)}
          {status && !['completed', 'needs_attention', 'cancelled'].includes(status) && <Text>{m.processing}</Text>}
          {organization && <View style={styles.panel}><Text variant="titleMedium">{m.summary}</Text><Text selectable>{organization.summary}</Text>
            {organization.keyPoints.map((point, index) => <Text selectable key={index}>• {point}</Text>)}
            {!!organization.decisions.length && <Text variant="titleSmall">{m.decisions}</Text>}
            {organization.decisions.map(decision => <Text selectable key={decision.id}>• {decision.text}</Text>)}
            {!!organization.actionItems.length && <Text variant="titleSmall">{m.actions}</Text>}
            {organization.actionItems.filter(item => !item.ignored).map(item => <Text selectable key={item.id}>• {item.title}{item.owner ? ` · ${item.owner}` : ''}</Text>)}
          </View>}
          {selected.noteId && matchesWorkspace && button(m.openNote, () => router.push(noteDetailRoute(selected.noteId!)))}
        </View>}
        {!!progress && <Text accessibilityLiveRegion="polite">{progress}</Text>}
        {error && <Text accessibilityRole="alert">{errorText}</Text>}
      </View>}
      ListEmptyComponent={<Text>{m.empty}</Text>}
      renderItem={({ item }) => <SwipeableRow enabled={!selection.selectionMode} actions={[{ key: 'open', icon: 'open-in-new', color: 'blue', label: m.open }]} onActionPress={() => selectRecording(item.id)}>
        <Pressable accessibilityRole="button" onPress={() => selection.selectionMode ? selection.toggleSelected(item.id) : selectRecording(item.id)}
          delayLongPress={LIST_DELAY_LONG_PRESS} onLongPress={() => { if (!selection.selectionMode) selection.startSelection(); selection.toggleSelected(item.id); }}
          style={[styles.row, { backgroundColor: colors.surface.base }]}>
          {selection.selectionMode && <ListSelectionCheckbox selected={selection.selectedIds.has(item.id)} />}
          <View style={styles.panel}><Text>{new Date(item.recordedAt).toLocaleString()}</Text><Text style={{ color: colors.text.secondary }}>{m[item.state]}</Text></View>
        </Pressable>
      </SwipeableRow>} />
    {selection.selectionMode && <BatchActionBar items={[{ key: 'sync', icon: 'cloud-upload-outline', label: m.syncSelected,
      disabled: action.isPending || !selection.selectedCount || items.some(item => selection.selectedIds.has(item.id) && item.state !== 'saved'),
      onPress: () => run(async () => { for (const item of items.filter(row => selection.selectedIds.has(row.id))) await sync(item); selection.exitSelectionMode(); }),
    }]} />}
  </View>;
}
const styles = StyleSheet.create({ screen: { flex: 1 }, content: { padding: spacing.lg, paddingBottom: 140, gap: spacing.md }, panel: { gap: spacing.md }, button: { padding: spacing.lg, borderRadius: radii.lg, minHeight: 48 }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg } });
