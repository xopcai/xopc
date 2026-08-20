import { useQuery } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
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

import { ListSkeleton } from '../../components/ListSkeleton';
import { useMessages } from '../../i18n/messages';
import { fetchChatAgents } from '../../query/agents';
import { queryKeys } from '../../query/keys';
import { searchMobileWorkspace, type MobileSearchHit } from '../../query/search';
import { useGatewayConfigured } from '../../query/sessions';
import { useTheme, FLOATING_BOTTOM_OFFSET, floatingBottomPadding } from '../../theme';
import { listSyncJournalEntries } from '../../sync/sync-journal';

import { shouldPreserveWorkspaceSearch } from './workspace-search-recovery';
import { pendingDraftSearchResults } from './workspace-search-aggregator';

type SearchResult =
  | MobileSearchHit
  | { id: string; kind: 'draft'; title: string; subtitle?: string; route: '/inbox'; updatedAt?: number };

const RESULT_ICONS: Record<SearchResult['kind'], string> = {
  note: 'note-text-outline',
  session: 'message-processing-outline',
  project: 'folder-outline',
  task: 'target',
  workflow_run: 'source-branch',
  draft: 'cloud-upload-outline',
};

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
  const searchTextRef = useRef(searchText);
  const query = searchText.trim();
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const searchEnabled = visible && configured && debouncedQuery.length > 0;

  useEffect(() => {
    searchTextRef.current = searchText;
  }, [searchText]);

  useEffect(() => {
    if (!query) {
      setDebouncedQuery('');
      return;
    }
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!visible) {
      if (!shouldPreserveWorkspaceSearch(searchTextRef.current)) setSearchText('');
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [visible]);

  const agents = useQuery({
    queryKey: queryKeys.agents,
    queryFn: fetchChatAgents,
    enabled: visible && configured,
  });
  const searchQuery = useQuery({
    queryKey: queryKeys.workspaceSearch(debouncedQuery),
    queryFn: () => searchMobileWorkspace({
      query: debouncedQuery,
      agentIds: agents.data?.items.map((agent) => agent.id) ?? [],
    }),
    enabled: searchEnabled && Boolean(agents.data),
  });

  const results = useMemo<SearchResult[]>(() => {
    if (!debouncedQuery) return [];
    const drafts: SearchResult[] = pendingDraftSearchResults(listSyncJournalEntries(), debouncedQuery).map((draft) => ({
      id: draft.id,
      kind: 'draft',
      title: draft.title,
      subtitle: draft.snippet,
      route: '/inbox',
      updatedAt: draft.updatedAt,
    }));
    return [...(searchQuery.data ?? []), ...drafts]
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [debouncedQuery, searchQuery.data]);

  const isLoading = agents.isLoading || searchQuery.isLoading;
  const isSearching = searchQuery.isFetching;

  const openResult = useCallback((item: SearchResult) => {
    onClose();
    router.push(item.route as Href);
  }, [onClose, router]);

  const renderItem = useCallback(({ item }: { item: SearchResult }) => {
    const title = item.title || sm.emptyNoteTitle;
    const meta = item.subtitle ? `${sm.kind[item.kind]} · ${item.subtitle}` : sm.kind[item.kind];

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
        accessibilityRole="button"
      >
        <View style={[styles.iconBubble, { backgroundColor: colors.accent.selectionBg }]}>
          <Icon source={RESULT_ICONS[item.kind]} size={18} color={colors.accent.primary} />
        </View>
        <View style={styles.resultText}>
          <Text numberOfLines={2} style={[styles.resultTitle, { color: colors.text.primary }]}>{title}</Text>
          <Text style={[styles.resultMeta, { color: colors.text.tertiary }]}>{meta}</Text>
        </View>
        <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
      </Pressable>
    );
  }, [colors, openResult, sm.emptyNoteTitle, sm.kind]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
        <View
          style={[
            styles.modalHeader,
            { paddingTop: insets.top, borderBottomColor: colors.border.subtle },
          ]}
        >
          <Pressable
            style={styles.headerButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={m.common.close}
          >
            <Icon source="chevron-down" size={26} color={colors.text.primary} />
          </Pressable>
          <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.text.primary }]}>
            {sm.title}
          </Text>
          <View style={styles.headerButton} />
        </View>

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
            <ListSkeleton count={6} />
          ) : agents.isError || searchQuery.isError ? (
            <View style={styles.center}>
              <Icon source="alert-circle-outline" size={40} color={colors.semantic.error} />
              <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{sm.searchFailed}</Text>
              <Pressable accessibilityRole="button" onPress={() => void (agents.isError ? agents.refetch() : searchQuery.refetch())}>
                <Text style={{ color: colors.accent.primary }}>{sm.retry}</Text>
              </Pressable>
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
                accessibilityLabel={sm.placeholder}
              />
              {searchText.length > 0 && (
                <Pressable accessibilityRole="button" accessibilityLabel={sm.clearSearch} onPress={() => setSearchText('')} hitSlop={8}>
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
  modalHeader: {
    minHeight: 56,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
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
