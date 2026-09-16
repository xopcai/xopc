import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { ListSkeleton } from '../../components/ListSkeleton';
import { useMessages } from '../../i18n/messages';
import { fetchComposerReferences, type ComposerReferenceItem, type ReferenceKind } from '../../query/composer-references';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, spacing, typography, useTheme } from '../../theme';

export function ComposerReferenceSheet({ initialKind, conversationId, selectedIds, onSelect, onClose, onLocalFile, filesDisabled, referencesFull }: {
  initialKind: ReferenceKind;
  conversationId: string;
  selectedIds: string[];
  onSelect: (item: ComposerReferenceItem) => void;
  onClose: () => void;
  onLocalFile: () => void;
  filesDisabled: boolean;
  referencesFull: boolean;
}) {
  const copy = useMessages().chat.references;
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const gatewayId = useGatewayStore(state => state.activeGatewayId);
  const [kind, setKind] = useState(initialKind);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [path, setPath] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 200);
    return () => clearTimeout(timer);
  }, [search]);
  const results = useQuery({
    queryKey: ['composer-references', gatewayId, conversationId, kind, debouncedSearch, path],
    queryFn: () => fetchComposerReferences(kind, conversationId, debouncedSearch, path),
    enabled: Boolean(gatewayId && conversationId),
    staleTime: 0,
  });
  const searchLabel = kind === 'file' ? copy.searchFile : copy.search;
  const pending = search.trim() !== debouncedSearch || results.isPending;
  return <BottomSheetModal visible onDismiss={onClose} title={copy.title} subtitle={copy.hint} maxHeight="90%" keyboardAvoiding
    headerAction={<Pressable style={styles.button} onPress={onClose} accessibilityRole="button"><Text>{copy.close}</Text></Pressable>}>
    <View style={[styles.body, { height: height * 0.6 }]}>
      <View style={styles.tabs}>
        {(['note', 'task', 'file'] as const).map(tab => <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: kind === tab }}
          style={[styles.tab, { backgroundColor: kind === tab ? colors.accent.soft : colors.surface.input }]}
          onPress={() => { setKind(tab); setSearch(''); setDebouncedSearch(''); setPath(''); }}>
          <Text style={{ color: kind === tab ? colors.accent.primary : colors.text.secondary }}>{copy[tab]}</Text>
        </Pressable>)}
      </View>
      <View style={[styles.search, { backgroundColor: colors.surface.input }]}>
        <Icon source="magnify" size={20} color={colors.text.tertiary} />
        <TextInput value={search} onChangeText={setSearch} placeholder={searchLabel} accessibilityLabel={searchLabel}
          placeholderTextColor={colors.text.tertiary} style={[styles.input, { color: colors.text.primary }]} autoCorrect={false} returnKeyType="search" />
        {search ? <Pressable style={styles.button} onPress={() => setSearch('')} accessibilityLabel={copy.clear} accessibilityRole="button"><Icon source="close" size={20} color={colors.text.secondary} /></Pressable> : null}
      </View>
      {kind === 'file' ? <>
        <Pressable style={styles.row} disabled={filesDisabled} onPress={onLocalFile} accessibilityRole="button" accessibilityState={{ disabled: filesDisabled }}>
          <Icon source="cellphone" size={22} color={colors.accent.primary} /><Text style={{ color: filesDisabled ? colors.text.disabled : colors.accent.primary }}>{copy.localFile}</Text>
        </Pressable>
        <Pressable style={styles.button} disabled={!path} onPress={() => { setPath(path.split('/').slice(0, -1).join('/')); setSearch(''); setDebouncedSearch(''); }} accessibilityRole="button">
          <Text numberOfLines={1} style={{ color: colors.text.secondary }}>{path ? `‹ ${path}` : copy.workspace}</Text>
        </Pressable>
      </> : <Text style={[styles.caption, { color: colors.text.tertiary }]}>{search.trim() ? copy.results : copy.recent}</Text>}
      {kind !== 'file' && referencesFull ? <Text style={[styles.caption, { color: colors.text.secondary }]}>{copy.limit}</Text> : null}
      {pending ? <ListSkeleton count={3} /> : results.isError ? <View style={styles.empty}>
        <Text>{copy.error}</Text><Pressable style={styles.button} accessibilityRole="button" onPress={() => void results.refetch()}><Text style={{ color: colors.accent.primary }}>{copy.retry}</Text></Pressable>
      </View> : <FlatList data={results.data ?? []} keyExtractor={item => `${item.kind}:${item.id}`} style={styles.list}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        ListEmptyComponent={<View style={styles.empty}><Text style={{ color: colors.text.tertiary }}>{search.trim() ? copy.noResults : copy.empty}</Text></View>}
        renderItem={({ item }) => {
          const selected = selectedIds.includes(`${item.kind}:${item.id}`);
          const disabled = selected || (item.kind === 'file' ? !item.directory && filesDisabled : referencesFull);
          return <Pressable style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surface.hover : colors.surface.panel, opacity: disabled ? 0.5 : 1 }]}
            accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled}
            onPress={() => {
              if (item.directory) { setPath(item.relativePath || ''); setSearch(''); setDebouncedSearch(''); }
              else onSelect(item);
            }}>
            <Icon source={item.kind === 'note' ? 'notebook-outline' : item.kind === 'task' ? 'checkbox-marked-circle-outline' : item.directory ? 'folder-outline' : 'file-outline'} size={22} color={colors.text.secondary} />
            <View style={styles.text}><Text numberOfLines={1} style={{ color: colors.text.primary }}>{item.title || copy.untitled}</Text>
              {item.description ? <Text numberOfLines={2} style={[styles.caption, { color: colors.text.tertiary }]}>{item.description}</Text> : null}</View>
            <Icon source={selected ? 'check' : item.directory ? 'chevron-right' : 'plus'} size={20} color={colors.accent.primary} />
          </Pressable>;
        }} />}
    </View>
  </BottomSheetModal>;
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.xl, gap: spacing.sm, flexShrink: 1 },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md },
  search: { flexDirection: 'row', alignItems: 'center', borderRadius: radii.md, paddingLeft: spacing.md },
  input: { flex: 1, minHeight: 44, ...typography.body, paddingHorizontal: spacing.sm },
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 44 },
  text: { flex: 1, gap: spacing.xxs },
  caption: { ...typography.caption },
  list: { flex: 1 },
  empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.md },
});
