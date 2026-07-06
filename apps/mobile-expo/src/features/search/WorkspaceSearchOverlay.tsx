import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingHeader } from '../../components/FloatingHeader';
import { t, useMessages } from '../../i18n/messages';
import { openNoteDetail } from '../../lib/navigation';
import { sessionDisplayName } from '../../lib/session-helpers';
import { queryKeys } from '../../query/keys';
import { fetchNotes, type NoteIndexEntry } from '../../query/notes';
import { fetchSessionsList, type SessionListItem, useGatewayConfigured } from '../../query/sessions';
import { useTheme, FLOATING_BOTTOM_OFFSET, floatingBottomPadding } from '../../theme';

type SearchResult =
  | { id: string; type: 'note'; note: NoteIndexEntry }
  | { id: string; type: 'session'; session: SessionListItem };

interface WorkspaceSearchOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export function WorkspaceSearchOverlay({ visible, onClose }: WorkspaceSearchOverlayProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const m = useMessages();
  const sm = m.workspaceSearch;
  const configured = useGatewayConfigured();
  const [searchText, setSearchText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const query = searchText.trim();
  const searchEnabled = visible && configured && query.length > 0;

  useEffect(() => {
    if (!visible) {
      setSearchText('');
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [visible]);

  const notesQuery = useQuery({
    queryKey: [...queryKeys.notesAll, 'search', query],
    queryFn: () => fetchNotes({ search: query, limit: 50, sortBy: 'updatedAt', sortOrder: 'desc' }),
    enabled: searchEnabled,
  });

  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions(query),
    queryFn: () => fetchSessionsList({ search: query, limit: 50, channel: null }),
    enabled: searchEnabled,
  });

  const results = useMemo<SearchResult[]>(() => {
    if (!query) return [];
    const noteResults = (notesQuery.data?.items ?? []).map((note) => ({
      id: `note:${note.id}`,
      type: 'note' as const,
      note,
    }));
    const sessionResults = (sessionsQuery.data?.items ?? []).map((session) => ({
      id: `session:${session.key}`,
      type: 'session' as const,
      session,
    }));
    return [...noteResults, ...sessionResults];
  }, [notesQuery.data?.items, query, sessionsQuery.data?.items]);

  const isLoading = notesQuery.isLoading || sessionsQuery.isLoading;
  const isSearching = notesQuery.isFetching || sessionsQuery.isFetching;

  const openResult = useCallback((item: SearchResult) => {
    onClose();
    if (item.type === 'note') {
      openNoteDetail(router, item.note.id);
      return;
    }
    router.push(`/chat/${item.session.key}`);
  }, [onClose, router]);

  const renderItem = useCallback(({ item }: { item: SearchResult }) => {
    const isNote = item.type === 'note';
    const title = isNote
      ? item.note.snippet || sm.emptyNoteTitle
      : sessionDisplayName(item.session, m.sessions.untitled);
    const meta = isNote
      ? sm.noteMeta
      : t(sm.sessionMessages, { count: item.session.messageCount });

    return (
      <Pressable
        style={({ pressed }) => [
          styles.resultCard,
          {
            backgroundColor: pressed ? colors.surface.hover : colors.surface.panel,
            borderColor: colors.border.subtle,
          },
        ]}
        onPress={() => openResult(item)}
      >
        <View style={[styles.iconBubble, { backgroundColor: colors.accent.selectionBg }]}>
          <Icon source={isNote ? 'note-text-outline' : 'message-processing-outline'} size={18} color={colors.accent.primary} />
        </View>
        <View style={styles.resultText}>
          <Text numberOfLines={2} style={[styles.resultTitle, { color: colors.text.primary }]}>{title}</Text>
          <Text style={[styles.resultMeta, { color: colors.text.tertiary }]}>{meta}</Text>
        </View>
        <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
      </Pressable>
    );
  }, [colors, m.sessions.untitled, openResult, sm.emptyNoteTitle, sm.noteMeta, sm.sessionMessages]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
        <FloatingHeader title={sm.title} onBack={onClose} />

        <View style={styles.content}>
          {!configured ? (
            <View style={styles.center}>
              <Icon source="cloud-off-outline" size={40} color={colors.text.tertiary} />
              <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{sm.gatewayDisconnectedTitle}</Text>
              <Text style={[styles.emptyHint, { color: colors.text.tertiary }]}>{sm.gatewayDisconnectedHint}</Text>
            </View>
          ) : !query ? (
            <View style={styles.center}>
              <Icon source="magnify" size={42} color={colors.text.tertiary} />
              <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{sm.idleTitle}</Text>
              <Text style={[styles.emptyHint, { color: colors.text.tertiary }]}>{sm.idleHint}</Text>
            </View>
          ) : isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.list}
              ListHeaderComponent={
                isSearching ? (
                  <View style={styles.searchingRow}>
                    <ActivityIndicator size="small" />
                    <Text style={[styles.searchingText, { color: colors.text.tertiary }]}>{sm.searching}</Text>
                  </View>
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.center}>
                  <Icon source="file-search-outline" size={40} color={colors.text.tertiary} />
                  <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{sm.noResultsTitle}</Text>
                  <Text style={[styles.emptyHint, { color: colors.text.tertiary }]}>{sm.noResultsHint}</Text>
                </View>
              }
            />
          )}
        </View>

        <KeyboardStickyView
          offset={{ closed: 0, opened: 0 }}
          style={{ marginBottom: FLOATING_BOTTOM_OFFSET }}
        >
          <View style={[styles.searchWrap, { paddingBottom: floatingBottomPadding(insets.bottom) }]}>
            <View style={[styles.searchShell, { backgroundColor: colors.surface.input, borderColor: colors.border.default }]}>
              <Icon source="magnify" size={20} color={colors.text.tertiary} />
              <TextInput
                ref={inputRef}
                style={[styles.searchInput, { color: colors.text.primary }]}
                placeholder={sm.placeholder}
                placeholderTextColor={colors.text.tertiary}
                value={searchText}
                onChangeText={setSearchText}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchText.length > 0 && (
                <Pressable onPress={() => setSearchText('')} hitSlop={8}>
                  <Icon source="close-circle" size={20} color={colors.text.tertiary} />
                </Pressable>
              )}
            </View>
          </View>
        </KeyboardStickyView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, minHeight: 0 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptyHint: { fontSize: 13, textAlign: 'center' },
  list: {
    padding: 16,
    paddingBottom: 96,
    gap: 10,
    flexGrow: 1,
  },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
  },
  searchingText: { fontSize: 13 },
  resultCard: {
    minHeight: 68,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultText: { flex: 1, gap: 4 },
  resultTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  resultMeta: { fontSize: 12 },
  searchWrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  searchShell: {
    minHeight: 46,
    borderRadius: 23,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: Platform.select({ ios: 10, android: 6, default: 8 }),
    borderWidth: 0,
  },
});
