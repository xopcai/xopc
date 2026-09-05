import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FileResource, FileSpace } from '@xopcai/gateway-contract';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { AppToast } from '../../components/AppToast';
import { ListSelectionCheckbox } from '../../components/ListSelectionCheckbox';
import { SwipeableRow } from '../../components/SwipeableRow';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import {
  fetchFileChildren,
  fetchFileSpaceForContext,
  fetchFileSpaces,
  fetchRecentFiles,
  searchFiles,
  uploadFileResource,
  type FileContextKind,
} from '../../query/files';
import { queryKeys } from '../../query/keys';
import { floatingBottomPadding, spacing, useTheme } from '../../theme';
import { FilePreviewModal, type PreviewableFile } from '../file-preview/FilePreviewModal';

import { useFileActions } from './file-actions';

function toPreviewable(file: FileResource): PreviewableFile {
  return { fileId: file.id, name: file.name, mimeType: file.mimeType, workspaceRelativePath: file.relativePath };
}

function iconFor(file: FileResource): string {
  if (file.kind === 'directory') return 'folder-outline';
  if (file.mimeType.startsWith('image/')) return 'image-outline';
  if (file.mimeType.startsWith('audio/')) return 'music-note-outline';
  if (file.mimeType.startsWith('video/')) return 'video-outline';
  if (file.mimeType.startsWith('text/')) return 'file-code-outline';
  return 'file-outline';
}

function FileRow({ file, source, onPress, actions }: { file: FileResource; source?: string; onPress: () => void; actions: ReturnType<typeof useFileActions> }) {
  const { colors } = useTheme();
  const labels = useMessages().filesPage;
  return (
    <SwipeableRow enabled={!actions.selectionMode} actions={[
      { key: 'copy', icon: 'content-copy', color: 'blue', label: labels.copyPath },
      { key: 'share', icon: 'share-variant-outline', color: 'green', label: labels.share },
    ]} onActionPress={(action) => action.key === 'copy' ? actions.copyPath(file) : actions.share(file)}>
      <Pressable
        style={({ pressed }) => [styles.row, { borderBottomColor: colors.border.subtle }, pressed && { backgroundColor: colors.surface.pressed }]}
        onPress={() => actions.selectionMode ? actions.toggleSelected(file.id) : onPress()}
        onLongPress={() => { if (!actions.selectionMode) { actions.startSelection(); actions.toggleSelected(file.id); } }}
        accessibilityState={{ selected: actions.selectedIds.has(file.id) }}
        accessibilityRole="button"
      >
        {actions.selectionMode ? <ListSelectionCheckbox selected={actions.selectedIds.has(file.id)} /> : null}
        <View style={[styles.icon, { backgroundColor: colors.surface.grouped }]}>
          <Icon source={iconFor(file)} size={21} color={colors.text.secondary} />
        </View>
        <View style={styles.rowCopy}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>{file.name}</Text>
          <Text numberOfLines={1} style={[styles.rowMeta, { color: colors.text.tertiary }]}>
            {source ? `${source} · ${file.relativePath}` : file.relativePath}
          </Text>
        </View>
        <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
      </Pressable>
    </SwipeableRow>
  );
}

export function FileListSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={styles.list}>
      {[0, 1, 2, 3, 4].map((item) => (
        <View key={item} style={styles.row}>
          <View style={[styles.skeletonIcon, { backgroundColor: colors.surface.grouped }]} />
          <View style={styles.skeletonCopy}>
            <View style={[styles.skeletonLine, { backgroundColor: colors.surface.grouped, width: '56%' }]} />
            <View style={[styles.skeletonLine, { backgroundColor: colors.surface.grouped, width: '78%' }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function FilesHubScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const labels = useMessages().filesPage;
  const [view, setView] = useState<'recent' | 'locations'>('recent');
  const [search, setSearch] = useState('');
  const spaces = useQuery({ queryKey: queryKeys.fileSpaces, queryFn: fetchFileSpaces });
  const recent = useQuery({ queryKey: queryKeys.recentFiles, queryFn: () => fetchRecentFiles(50) });
  const results = useQuery({
    queryKey: queryKeys.fileSearch(search),
    queryFn: () => searchFiles(search),
    enabled: search.trim().length > 0,
  });
  const spaceNames = useMemo(() => new Map((spaces.data ?? []).map((space) => [space.id, space.title])), [spaces.data]);
  const files = search.trim().length > 0 ? results.data : recent.data;
  const current = search.trim() ? results : view === 'locations' ? spaces : recent;
  const loading = current.isLoading;
  const actions = useFileActions(files ?? []);
  const [active, setActive] = useState<PreviewableFile | null>(null);

  const openFile = (file: FileResource) => setActive(toPreviewable(file));

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={labels.title} onBack={() => router.back()} />
      <View style={[styles.searchBox, { backgroundColor: colors.surface.input }]}>
        <Icon source="magnify" size={20} color={colors.text.tertiary} />
        <TextInput
          value={search}
          onChangeText={(value) => { actions.exitSelectionMode(); setSearch(value); }}
          placeholder={labels.searchPlaceholder}
          placeholderTextColor={colors.text.tertiary}
          style={[styles.searchInput, { color: colors.text.primary }]}
        />
      </View>
      {!search.trim() ? (
        <View style={[styles.segment, { backgroundColor: colors.surface.input }]}>
          {(['recent', 'locations'] as const).map((item) => (
            <Pressable
              key={item}
              style={[styles.segmentButton, view === item && { backgroundColor: colors.surface.panel }]}
              onPress={() => { actions.exitSelectionMode(); setView(item); }}
            >
              <Text style={{ color: view === item ? colors.text.primary : colors.text.secondary }}>
                {item === 'recent' ? labels.recent : labels.locations}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {loading ? <FileListSkeleton /> : current.isError ? <FileLoadError error={current.error} onRetry={() => void current.refetch()} /> : view === 'locations' && !search.trim() ? (
        <FlatList
          refreshControl={<RefreshControl refreshing={spaces.isRefetching} onRefresh={() => void spaces.refetch()} />}
          data={spaces.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.locationRow, { borderBottomColor: colors.border.subtle }, pressed && { backgroundColor: colors.surface.pressed }]}
              onPress={() => router.push(`/files/${encodeURIComponent(item.id)}` as never)}
            >
              <View style={[styles.icon, { backgroundColor: colors.surface.grouped }]}>
                <Icon source="folder-multiple-outline" size={21} color={colors.text.secondary} />
              </View>
              <View style={styles.rowCopy}>
                <Text style={[styles.rowTitle, { color: colors.text.primary }]}>{item.title}</Text>
                <Text style={[styles.rowMeta, { color: colors.text.tertiary }]}>{item.bindings.map((binding) => binding.kind).join(' · ')}</Text>
              </View>
              <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
            </Pressable>
          )}
          ListEmptyComponent={<EmptyState title={labels.noLocations} hint={labels.noLocationsHint} />}
        />
      ) : (
        <FlatList
          data={files ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={current.isRefetching} onRefresh={() => void current.refetch()} />}
          renderItem={({ item }) => <FileRow file={item} actions={actions} source={spaceNames.get(item.spaceId) ?? labels.unknownLocation} onPress={() => openFile(item)} />}
          ListEmptyComponent={<EmptyState title={labels.emptyTitle} hint={labels.emptyHint} />}
        />
      )}
      {actions.overlays}
      <FilePreviewModal visible={Boolean(active)} file={active} onClose={() => setActive(null)} />
    </View>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <Icon source="folder-open-outline" size={40} color={colors.text.tertiary} />
      <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{title}</Text>
      <Text style={[styles.emptyHint, { color: colors.text.tertiary }]}>{hint}</Text>
    </View>
  );
}

export function FileLoadError({ error, onRetry }: { error?: unknown; onRetry: () => void }) {
  const m = useMessages();
  return <View style={styles.empty}>
    <Text>{m.filesPage.loadFailed}</Text>
    {error instanceof Error ? <Text style={styles.emptyHint}>{error.message}</Text> : null}
    <Button onPress={onRetry}>{m.common.retry}</Button>
  </View>;
}

function BrowserLoadingState({ loading, error, onRetry }: { loading: boolean; error?: unknown; onRetry: () => void }) {
  const router = useRouter();
  const { colors } = useTheme();
  const labels = useMessages().filesPage;
  return <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
    <NativeScreenHeader title={labels.title} onBack={() => router.back()} />
    {loading ? <FileListSkeleton /> : <FileLoadError error={error} onRetry={onRetry} />}
  </View>;
}

export function ContextFileBrowserScreen({ kind, id }: { kind: FileContextKind; id: string }) {
  const context = useQuery({
    queryKey: queryKeys.fileSpaceContext(kind, id),
    queryFn: () => fetchFileSpaceForContext(kind, id),
    enabled: Boolean(id),
  });
  if (!context.data) return <BrowserLoadingState loading={context.isLoading} error={context.error} onRetry={() => void context.refetch()} />;
  return <FileSpaceBrowserScreen key={context.data.id} space={context.data} />;
}

export function FileSpaceBrowserRouteScreen({ spaceId }: { spaceId: string }) {
  const labels = useMessages().filesPage;
  const spaces = useQuery({ queryKey: queryKeys.fileSpaces, queryFn: fetchFileSpaces });
  const space = spaces.data?.find((item) => item.id === spaceId);
  if (!space) return <BrowserLoadingState loading={spaces.isLoading} error={spaces.error ?? new Error(labels.locationUnavailable)} onRetry={() => void spaces.refetch()} />;
  return <FileSpaceBrowserScreen key={space.id} space={space} />;
}

function FileSpaceBrowserScreen({ space }: { space: FileSpace }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const labels = useMessages().filesPage;
  const [directory, setDirectory] = useState('');
  const [active, setActive] = useState<PreviewableFile | null>(null);
  const files = useQuery({
    queryKey: queryKeys.fileChildren(space.id, directory),
    queryFn: () => fetchFileChildren(space.id, directory),
  });
  const actions = useFileActions(files.data ?? []);
  const [toast, setToast] = useState('');
  const navigateDirectory = (path: string) => { actions.exitSelectionMode(); setDirectory(path); };
  const upload = useMutation({
    mutationFn: uploadFileResource,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['files'] });
      setToast(labels.uploadSucceeded);
    },
    onError: () => setToast(labels.uploadFailed),
  });
  const breadcrumbs = useMemo(() => {
    const output = [{ label: labels.root, path: '' }];
    let path = '';
    for (const part of directory.split('/').filter(Boolean)) {
      path = path ? `${path}/${part}` : part;
      output.push({ label: part, path });
    }
    return output;
  }, [directory, labels.root]);

  const pickFile = async () => {
    if (upload.isPending) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      const asset = picked.canceled ? undefined : picked.assets[0];
      if (!asset) return;
      upload.mutate({ spaceId: space.id, directory, uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
    } catch { setToast(labels.uploadFailed); }
  };
  const goBack = () => {
    if (!directory) return router.back();
    navigateDirectory(directory.split('/').slice(0, -1).join('/'));
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader
        title={space.title}
        onBack={goBack}
        rightActions={[
          { icon: 'share-variant-outline', onPress: () => actions.shareDirectory(space.id, directory), accessibilityLabel: labels.shareCurrentFolder },
          ...(space.writable ? [{ icon: upload.isPending ? 'progress-upload' : 'file-upload-outline', onPress: () => void pickFile(), accessibilityLabel: labels.uploadFile }] : []),
        ]}
      />
      <ScrollView style={styles.breadcrumbScroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.breadcrumbs}>
        {breadcrumbs.map((crumb, index) => (
          <View key={crumb.path || 'root'} style={styles.crumbGroup}>
            {index ? <Icon source="chevron-right" size={14} color={colors.text.tertiary} /> : null}
            <Pressable style={styles.crumbButton} onPress={() => navigateDirectory(crumb.path)} disabled={crumb.path === directory}>
              <Text style={{ color: crumb.path === directory ? colors.accent.primary : colors.text.secondary }}>{crumb.label}</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
      {files.isLoading ? <FileListSkeleton /> : files.isError ? <FileLoadError error={files.error} onRetry={() => void files.refetch()} /> : (
        <FlatList
          refreshControl={<RefreshControl refreshing={files.isRefetching} onRefresh={() => void files.refetch()} />}
          data={files.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: floatingBottomPadding(0) + spacing.xxl }]}
          renderItem={({ item }) => (
            <FileRow
              file={item}
              actions={actions}
              onPress={() => item.kind === 'directory' ? navigateDirectory(item.relativePath) : setActive(toPreviewable(item))}
            />
          )}
          ListEmptyComponent={<EmptyState title={labels.emptyTitle} hint={labels.emptyHint} />}
        />
      )}
      <AppToast visible={Boolean(toast)} onDismiss={() => setToast('')}>{toast}</AppToast>
      {actions.overlays}
      <FilePreviewModal visible={Boolean(active)} file={active} onClose={() => setActive(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchBox: { marginHorizontal: 16, marginTop: 12, minHeight: 42, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8 },
  segment: { margin: 16, padding: 3, borderRadius: 10, flexDirection: 'row' },
  segmentButton: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  list: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: floatingBottomPadding(0) + spacing.xxl },
  row: { minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  locationRow: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowMeta: { fontSize: 12, marginTop: 3 },
  skeletonIcon: { width: 38, height: 38, borderRadius: 10 },
  skeletonCopy: { flex: 1, gap: 8 },
  skeletonLine: { height: 10, borderRadius: 5 },
  empty: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 80, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptyHint: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  breadcrumbScroll: { flexGrow: 0 },
  crumbButton: { minHeight: spacing.xxxl, minWidth: spacing.xxxl, justifyContent: 'center' },
  breadcrumbs: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  crumbGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
