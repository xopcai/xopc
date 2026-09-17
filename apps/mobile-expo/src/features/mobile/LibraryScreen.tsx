import { useMutation, useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { fetchRecentFiles } from '../../query/files';
import { fetchNotes } from '../../query/notes';
import { useGatewayConfigured } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { spacing, typography, useTheme } from '../../theme';
import { RecentFileCard } from './RecentFileCard';
import { HubEmpty, HubRow, HubSection } from './HubComponents';

export function LibraryScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const m = useMessages().mobileExperience;
  const configured = useGatewayConfigured();
  const gatewayId = useGatewayStore(s => s.activeGatewayId);
  const files = useQuery({ queryKey: ['files', 'recent', 'library', gatewayId], queryFn: () => fetchRecentFiles(8), enabled: configured, refetchInterval: 60_000 });
  const notes = useQuery({ queryKey: ['notes', 'library', gatewayId], queryFn: () => fetchNotes({ limit: 6, sortBy: 'updatedAt', sortOrder: 'desc' }), enabled: configured, refetchInterval: 60_000 });
  const { refetch: refreshFiles } = files;
  const { refetch: refreshNotes } = notes;
  const refresh = useCallback(async () => { if (configured) await Promise.all([refreshFiles(), refreshNotes()]); }, [configured, refreshFiles, refreshNotes]);
  const refreshMutation = useMutation({ mutationFn: refresh });
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
    <NativeScreenHeader title={m.library} largeTitle />
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshMutation.isPending} onRefresh={() => { if (!refreshMutation.isPending) refreshMutation.mutate(); }} />}>
      <Text style={[styles.subtitle, { color: colors.text.secondary }]}>{m.libraryHint}</Text>
      <HubRow title={m.files} icon="folder-outline" onPress={() => router.push('/files')} />
      <HubRow title={m.notes} icon="notebook-outline" onPress={() => router.push('/notes')} />
      <HubRow title={m.inbox} icon="inbox-outline" onPress={() => router.push('/inbox')} />
      {!configured ? <HubEmpty text={m.connectHint} /> : <>
        <HubSection title={m.recentFiles}>
          {files.isLoading ? <ListSkeleton count={3} /> : files.isError ? <HubRow title={m.loadFailed} summary={m.retry} icon="refresh" onPress={() => void files.refetch()} /> : files.data?.length ? files.data.slice(0, 3).map(file => <RecentFileCard key={file.id} file={file} onPress={() => router.push(`/files/open/${encodeURIComponent(file.id)}`)} />) : <HubEmpty text={m.noFiles} />}
        </HubSection>
        <HubSection title={m.recentNotes}>
          {notes.isLoading ? <ListSkeleton count={3} /> : notes.isError ? <HubRow title={m.loadFailed} summary={m.retry} icon="refresh" onPress={() => void notes.refetch()} /> : notes.data?.items.length ? notes.data.items.map(note => <HubRow key={note.id} title={note.title || m.untitled} summary={note.snippet} icon="note-text-outline" onPress={() => router.push(`/items/${note.id}`)} />) : <HubEmpty text={m.noNotes} />}
        </HubSection>
      </>}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({ screen: { flex: 1 }, content: { padding: spacing.content, paddingBottom: spacing.section, gap: spacing.sm }, subtitle: { ...typography.body, marginBottom: spacing.md } });
