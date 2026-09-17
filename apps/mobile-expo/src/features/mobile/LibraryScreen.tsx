import { useMutation, useQuery } from '@tanstack/react-query';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Modal, Portal, Text } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { t, useMessages } from '../../i18n/messages';
import { fetchRecentFiles } from '../../query/files';
import { queryKeys } from '../../query/keys';
import { fetchNotes } from '../../query/notes';
import { useGatewayConfigured } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import { radii, spacing, typography, useTheme } from '../../theme';
import { useRecordings } from '../recordings/recordings';
import { LibrarySearchOverlay } from '../search/LibrarySearchOverlay';
import { HubEmpty, HubRow, HubSection } from './HubComponents';
import { buildLibraryRecentItems, type LibraryRecentItem } from './library-recent';

const RECENT_LIMIT = 8;

export function LibraryScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const messages = useMessages();
  const m = messages.mobileExperience;
  const configured = useGatewayConfigured();
  const gatewayId = useGatewayStore(s => s.activeGatewayId);
  const language = usePreferencesStore(s => s.language);
  const recordings = useRecordings(state => state.items);
  const [searchOpen, setSearchOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const files = useQuery({ queryKey: ['files', 'recent', 'library', gatewayId], queryFn: () => fetchRecentFiles(RECENT_LIMIT), enabled: configured, refetchInterval: 60_000 });
  const notes = useQuery({ queryKey: ['notes', 'library', gatewayId], queryFn: () => fetchNotes({ limit: RECENT_LIMIT, sortBy: 'updatedAt', sortOrder: 'desc' }), enabled: configured, refetchInterval: 60_000 });
  const inbox = useQuery({ queryKey: queryKeys.homeInboxCount, queryFn: () => fetchNotes({ status: 'inbox', limit: 1 }), enabled: configured, refetchInterval: 60_000 });
  const { refetch: refreshFiles } = files;
  const { refetch: refreshNotes } = notes;
  const { refetch: refreshInbox } = inbox;
  const recent = useMemo(() => buildLibraryRecentItems({
    files: files.data ?? [],
    notes: notes.data?.items ?? [],
    recordings,
    untitledNote: m.untitled,
    recordingTitle: messages.recordings.title,
    limit: RECENT_LIMIT,
  }), [files.data, m.untitled, messages.recordings.title, notes.data?.items, recordings]);
  const refresh = useCallback(async () => {
    if (configured) await Promise.all([refreshFiles(), refreshNotes(), refreshInbox()]);
  }, [configured, refreshFiles, refreshInbox, refreshNotes]);
  const refreshMutation = useMutation({ mutationFn: refresh });
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const openCreateRoute = useCallback((route: Href) => {
    setCreateOpen(false);
    requestAnimationFrame(() => router.push(route));
  }, [router]);

  return <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
    <NativeScreenHeader
      title={m.library}
      largeTitle
      onSearchPress={() => setSearchOpen(true)}
      searchPlaceholder={m.searchLibrary}
      rightActions={[{ icon: 'plus', accessibilityLabel: m.createContent, onPress: () => setCreateOpen(true) }]}
    />
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshMutation.isPending} onRefresh={() => { if (!refreshMutation.isPending) refreshMutation.mutate(); }} />}
    >
      <Text style={[styles.subtitle, { color: colors.text.secondary }]}>{m.libraryHint}</Text>

      {(inbox.data?.total ?? 0) > 0 ? <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/inbox')}
        style={({ pressed }) => [styles.inboxCard, { backgroundColor: pressed ? colors.surface.pressed : colors.accent.soft, borderColor: colors.accent.selectionBg }]}
      >
        <View style={[styles.inboxIcon, { backgroundColor: colors.surface.panel }]}><Icon source="inbox-arrow-down-outline" size={22} color={colors.accent.primary} /></View>
        <View style={styles.inboxCopy}>
          <Text style={[styles.inboxTitle, { color: colors.text.primary }]}>{m.inbox}</Text>
          <Text style={[styles.inboxHint, { color: colors.text.secondary }]}>{t(m.inboxPending, { count: inbox.data?.total ?? 0 })}</Text>
        </View>
        <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
      </Pressable> : null}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text.secondary }]}>{m.quickAccess}</Text>
        <View style={styles.shortcutGrid}>
          <LibraryShortcut icon="notebook-outline" title={messages.drawer.notes} onPress={() => router.push('/notes')} />
          <LibraryShortcut icon="folder-outline" title={messages.drawer.files} onPress={() => router.push('/files')} />
          <LibraryShortcut icon="microphone-outline" title={messages.recordings.title} onPress={() => router.push('/recordings')} />
          <LibraryShortcut icon="inbox-outline" title={m.inbox} onPress={() => router.push('/inbox')} />
        </View>
      </View>

      {!configured ? <HubEmpty text={m.connectHint} /> : <HubSection title={m.recentItems}>
        {files.isLoading || notes.isLoading ? <ListSkeleton count={4} /> : files.isError || notes.isError ? (
          <HubRow title={m.loadFailed} summary={m.retry} icon="refresh" onPress={() => void refresh()} />
        ) : recent.length ? recent.map(item => <RecentLibraryRow key={item.id} item={item} locale={language === 'zh' ? 'zh-CN' : 'en-US'} />) : <HubEmpty text={m.noLibraryItems} />}
      </HubSection>}
    </ScrollView>

    <LibrarySearchOverlay visible={searchOpen} onClose={() => setSearchOpen(false)} />
    <Portal>
      <Modal visible={createOpen} onDismiss={() => setCreateOpen(false)} contentContainerStyle={[styles.createSheet, { backgroundColor: colors.surface.panel }]}>
        <Text style={[styles.createTitle, { color: colors.text.primary }]}>{m.createContent}</Text>
        <CreateAction icon="note-plus-outline" label={m.createNote} onPress={() => openCreateRoute({ pathname: '/notes', params: { create: '1' } })} />
        <CreateAction icon="file-upload-outline" label={m.uploadFiles} onPress={() => openCreateRoute('/files')} />
        <CreateAction icon="microphone-plus" label={m.startRecording} onPress={() => openCreateRoute('/recordings')} />
      </Modal>
    </Portal>
  </View>;
}

function LibraryShortcut({ icon, title, onPress }: { icon: string; title: string; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.shortcut, {
    backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel,
    borderColor: colors.border.subtle,
  }]}>
    <View style={[styles.shortcutIcon, { backgroundColor: colors.accent.soft }]}><Icon source={icon} size={22} color={colors.accent.primary} /></View>
    <Text style={[styles.shortcutTitle, { color: colors.text.primary }]}>{title}</Text>
    <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
  </Pressable>;
}

function RecentLibraryRow({ item, locale }: { item: LibraryRecentItem; locale: string }) {
  const router = useRouter();
  const messages = useMessages();
  const kind = {
    file: messages.drawer.files,
    note: messages.drawer.notes,
    recording: messages.recordings.title,
  }[item.kind];
  const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(item.updatedAt);
  const icon = item.kind === 'file' ? 'file-document-outline' : item.kind === 'note' ? 'note-text-outline' : 'microphone-outline';
  return <HubRow title={item.title} summary={`${kind} · ${date}`} icon={icon} onPress={() => router.push(item.route as Href)} />;
}

function CreateAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.createAction, pressed && { backgroundColor: colors.surface.pressed }]}>
    <View style={[styles.createIcon, { backgroundColor: colors.accent.soft }]}><Icon source={icon} size={21} color={colors.accent.primary} /></View>
    <Text style={[styles.createLabel, { color: colors.text.primary }]}>{label}</Text>
    <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.content, paddingBottom: spacing.section, gap: spacing.section },
  subtitle: { ...typography.body, marginBottom: -spacing.sm },
  inboxCard: { minHeight: 76, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  inboxIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  inboxCopy: { flex: 1, minWidth: 0 },
  inboxTitle: { ...typography.heading },
  inboxHint: { ...typography.label, marginTop: spacing.xs },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.label, fontWeight: '600' },
  shortcutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  shortcut: { minWidth: '46%', flexGrow: 1, minHeight: 68, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shortcutIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  shortcutTitle: { ...typography.ui, flex: 1, fontWeight: '600' },
  createSheet: { marginHorizontal: spacing.content, padding: spacing.lg, borderRadius: radii.xl, gap: spacing.xs },
  createTitle: { ...typography.heading, marginBottom: spacing.sm },
  createAction: { minHeight: 56, borderRadius: radii.md, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  createIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  createLabel: { ...typography.ui, flex: 1, fontWeight: '600' },
});
