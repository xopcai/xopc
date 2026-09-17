import { useQuery } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListSkeleton } from '../../components/ListSkeleton';
import { useMessages } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import { searchMobileLibrary, type LibrarySearchHit } from '../../query/search';
import { useGatewayConfigured } from '../../query/sessions';
import { listSyncJournalEntries } from '../../sync/sync-journal';
import { FLOATING_BOTTOM_OFFSET, floatingBottomPadding, radii, spacing, typography, useTheme } from '../../theme';
import { pendingLibraryDrafts, type PendingLibraryDraft } from './pending-library-drafts';

type SearchResult = LibrarySearchHit | PendingLibraryDraft;

const RESULT_ICONS: Record<SearchResult['kind'], string> = {
  file: 'file-document-outline',
  note: 'note-text-outline',
  draft: 'cloud-upload-outline',
};

export function LibrarySearchOverlay({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const m = useMessages();
  const copy = m.librarySearch;
  const configured = useGatewayConfigured();
  const [searchText, setSearchText] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const inputRef = useRef<TextInput>(null);
  const query = searchText.trim();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [visible]);

  const searchQuery = useQuery({
    queryKey: queryKeys.librarySearch(debouncedQuery),
    queryFn: () => searchMobileLibrary(debouncedQuery),
    enabled: visible && configured && debouncedQuery.length > 0,
  });
  const results = useMemo<SearchResult[]>(() => [
    ...(searchQuery.data ?? []),
    ...pendingLibraryDrafts(listSyncJournalEntries(), debouncedQuery),
  ].sort((left, right) => right.updatedAt - left.updatedAt), [debouncedQuery, searchQuery.data]);

  const openResult = useCallback((item: SearchResult) => {
    onClose();
    router.push(item.route as Href);
  }, [onClose, router]);

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}> 
      <View style={[styles.header, { paddingTop: insets.top, borderBottomColor: colors.border.subtle }]}> 
        <Pressable style={styles.headerButton} onPress={onClose} accessibilityRole="button" accessibilityLabel={m.common.close}>
          <Icon source="chevron-down" size={26} color={colors.text.primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text.primary }]}>{copy.title}</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.content}>
        {!configured ? <SearchState icon="cloud-off-outline" title={copy.gatewayDisconnectedTitle} hint={copy.gatewayDisconnectedHint} />
          : !query ? <SearchState icon="magnify" title={copy.idleTitle} hint={copy.idleHint} />
            : searchQuery.isLoading ? <ListSkeleton count={6} />
              : searchQuery.isError ? <SearchState icon="alert-circle-outline" title={copy.searchFailed} action={copy.retry} onAction={() => void searchQuery.refetch()} />
                : <FlatList
                    data={results}
                    keyExtractor={item => item.id}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.list}
                    ListHeaderComponent={searchQuery.isFetching ? <View style={styles.searching}><ActivityIndicator size="small" /><Text style={{ color: colors.text.tertiary }}>{copy.searching}</Text></View> : null}
                    ListEmptyComponent={<SearchState icon="file-search-outline" title={copy.noResultsTitle} hint={copy.noResultsHint} />}
                    renderItem={({ item }) => <Pressable
                      accessibilityRole="button"
                      onPress={() => openResult(item)}
                      style={({ pressed }) => [styles.result, { backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel, borderColor: colors.border.subtle }]}
                    >
                      <View style={[styles.resultIcon, { backgroundColor: colors.accent.soft }]}><Icon source={RESULT_ICONS[item.kind]} size={19} color={colors.accent.primary} /></View>
                      <View style={styles.resultCopy}>
                        <Text numberOfLines={2} style={[styles.resultTitle, { color: colors.text.primary }]}>{item.title || copy.emptyNoteTitle}</Text>
                        <Text numberOfLines={1} style={[styles.resultMeta, { color: colors.text.tertiary }]}>{copy.kind[item.kind]}{item.subtitle ? ` · ${item.subtitle}` : ''}</Text>
                      </View>
                      <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
                    </Pressable>}
                  />}
      </View>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={{ marginBottom: FLOATING_BOTTOM_OFFSET }}>
        <View style={[styles.searchWrap, { paddingBottom: floatingBottomPadding(insets.bottom) }]}> 
          <View style={[styles.searchShell, { backgroundColor: colors.surface.input, borderColor: colors.border.default }]}> 
            <Icon source="magnify" size={20} color={colors.text.tertiary} />
            <TextInput ref={inputRef} value={searchText} onChangeText={setSearchText} placeholder={copy.placeholder} placeholderTextColor={colors.text.tertiary}
              style={[styles.searchInput, { color: colors.text.primary }]} returnKeyType="search" autoCapitalize="none" autoCorrect={false} />
            {searchText ? <Pressable accessibilityRole="button" accessibilityLabel={copy.clearSearch} onPress={() => setSearchText('')} hitSlop={8}>
              <Icon source="close-circle" size={20} color={colors.text.tertiary} />
            </Pressable> : null}
          </View>
        </View>
      </KeyboardStickyView>
    </View>
  </Modal>;
}

function SearchState({ icon, title, hint, action, onAction }: { icon: string; title: string; hint?: string; action?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return <View style={styles.state}>
    <Icon source={icon} size={40} color={colors.text.tertiary} />
    <Text style={[styles.stateTitle, { color: colors.text.primary }]}>{title}</Text>
    {hint ? <Text style={[styles.stateHint, { color: colors.text.tertiary }]}>{hint}</Text> : null}
    {action && onAction ? <Pressable accessibilityRole="button" onPress={onAction}><Text style={{ color: colors.accent.primary }}>{action}</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 56, paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.heading, flex: 1, textAlign: 'center' },
  content: { flex: 1, minHeight: 0 },
  state: { flex: 1, minHeight: 240, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl, gap: spacing.sm },
  stateTitle: { ...typography.heading, textAlign: 'center' },
  stateHint: { ...typography.label, textAlign: 'center' },
  list: { padding: spacing.lg, paddingBottom: 96, gap: spacing.sm, flexGrow: 1 },
  searching: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.sm },
  result: { minHeight: 68, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resultIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  resultCopy: { flex: 1, minWidth: 0 },
  resultTitle: { ...typography.ui, fontWeight: '600' },
  resultMeta: { ...typography.caption, marginTop: spacing.xs },
  searchWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  searchShell: { minHeight: 46, borderRadius: 23, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  searchInput: { flex: 1, ...typography.ui, paddingVertical: Platform.select({ ios: 10, android: 6, default: 8 }) },
});
