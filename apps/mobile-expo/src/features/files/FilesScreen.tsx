import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';

import { FloatingHeader } from '../../components/FloatingHeader';
import { BottomSheetModal } from '../../components/BottomSheetModal';
import { AppToast } from '../../components/AppToast';
import { LIST_DELAY_LONG_PRESS } from '../../constants/list-interaction';
import { TOAST_DURATION_SHORT } from '../../constants/toast';
import { useMessages } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import {
  fetchWorkspaceDir,
  normalizeWorkspaceDir,
  parentWorkspaceDir,
  type WorkspaceEntry,
  type WorkspaceScope,
  workspaceScopeKey,
} from '../../query/workspace-files';
import { type ShareAutoRequest } from '../../api/share';
import { useGatewayConfigured } from '../../query/sessions';
import { useCreateShare } from '../../query/shares';
import { floatingBottomPadding, radii, spacing, typography, useTheme } from '../../theme';
import { FilePreviewModal, type PreviewableFile } from '../chat/FilePreviewModal';
import { setAppClipboardStringAsync } from '../clipboard-intake/write-app-clipboard';
import { mimeTypeFromFileName } from '../chat/tool-result-file-paths';
import { ShareSheet } from '../share/ShareSheet';

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function fileName(pathOrName: string): string {
  const parts = pathOrName.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? pathOrName;
}

function entryIcon(entry: WorkspaceEntry): string {
  if (entry.isDirectory) return 'folder-outline';
  const name = entry.name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name)) return 'image-outline';
  if (/\.(md|markdown)$/.test(name)) return 'language-markdown-outline';
  if (/\.(html?|css|tsx?|jsx?|json|ya?ml|txt|csv|xml|sh)$/.test(name)) return 'file-code-outline';
  return 'file-outline';
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function isPreviewableEntry(entry: WorkspaceEntry): boolean {
  if (entry.isDirectory) return true;
  const name = entry.name || fileName(entry.path);
  const mimeType = mimeTypeFromFileName(name);
  const ext = extensionOf(name);
  if (mimeType.startsWith('image/')) return true;
  if (mimeType.startsWith('text/')) return true;
  if (mimeType === 'text/markdown') return true;
  return [
    'bmp',
    'cjs',
    'css',
    'csv',
    'gif',
    'htm',
    'html',
    'jpeg',
    'jpg',
    'js',
    'json',
    'jsx',
    'mjs',
    'md',
    'markdown',
    'png',
    'sh',
    'svg',
    'ts',
    'tsx',
    'txt',
    'webp',
    'xml',
    'yaml',
    'yml',
  ].includes(ext);
}

function entrySubtitle(entry: WorkspaceEntry, labels: ReturnType<typeof useMessages>['filesPage']): string {
  if (entry.isDirectory) return labels.folder;
  const ext = entry.name.includes('.') ? entry.name.split('.').pop()?.toUpperCase() : '';
  return ext ? labels.fileType.replace('{{type}}', ext) : labels.file;
}

function entryToPreviewable(entry: WorkspaceEntry): PreviewableFile {
  return {
    name: entry.name || fileName(entry.path),
    mimeType: mimeTypeFromFileName(entry.name || entry.path),
    workspaceRelativePath: entry.path,
    absolutePath: entry.absolutePath,
  };
}

function buildShareRequest(entry: WorkspaceEntry, scope: WorkspaceScope): ShareAutoRequest {
  return {
    path: normalizeWorkspaceDir(entry.path),
    audience: 'friend',
    ...(scope.kind === 'session' ? { sessionKey: scope.sessionKey } : {}),
    ...(scope.kind === 'agent' ? { agentId: scope.agentId } : {}),
  };
}

export function FilesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const configured = useGatewayConfigured();
  const { colors } = useTheme();
  const m = useMessages();
  const labels = m.filesPage;
  const createShare = useCreateShare();
  const sessionKey = firstParam(params.sessionKey).trim();
  const agentId = firstParam(params.agentId).trim();
  const initialDir = normalizeWorkspaceDir(firstParam(params.dir));
  const [currentDir, setCurrentDir] = useState(initialDir);
  const [activeFile, setActiveFile] = useState<PreviewableFile | null>(null);
  const [actionTarget, setActionTarget] = useState<WorkspaceEntry | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareAutoRequest | null>(null);
  const [confirmFolderShare, setConfirmFolderShare] = useState<ShareAutoRequest | null>(null);
  const [toast, setToast] = useState('');

  const scope = useMemo<WorkspaceScope>(() => {
    if (sessionKey) return { kind: 'session', sessionKey };
    if (agentId) return { kind: 'agent', agentId };
    return { kind: 'default' };
  }, [agentId, sessionKey]);
  const scopeKey = workspaceScopeKey(scope);

  const query = useQuery({
    queryKey: queryKeys.workspaceDir(scopeKey, currentDir),
    queryFn: () => fetchWorkspaceDir({ dir: currentDir, scope }),
    enabled: configured,
  });

  const breadcrumbs = useMemo(() => {
    const parts = currentDir.split('/').filter(Boolean);
    const crumbs = [{ label: labels.root, path: '' }];
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }, [currentDir, labels.root]);

  const openEntry = (entry: WorkspaceEntry) => {
    if (entry.isDirectory) {
      setCurrentDir(normalizeWorkspaceDir(entry.path));
      return;
    }
    if (!isPreviewableEntry(entry)) {
      void downloadEntry(entry);
      return;
    }
    setActiveFile(entryToPreviewable(entry));
  };

  const downloadEntry = async (entry: WorkspaceEntry) => {
    try {
      const payload = await createShare.mutateAsync(buildShareRequest(entry, scope));
      await Linking.openURL(payload.share.lanUrl ?? payload.share.shareUrl);
    } catch {
      setToast(labels.downloadFailed);
    }
  };

  const copyEntryPath = async (entry: WorkspaceEntry) => {
    await setAppClipboardStringAsync(entry.absolutePath ?? entry.path);
    setToast(labels.pathCopied);
  };

  const shareEntry = (entry: WorkspaceEntry) => {
    if (entry.isDirectory) {
      requestFolderShare(entry);
      return;
    }
    setShareTarget(buildShareRequest(entry, scope));
  };

  const handleActionCopy = () => {
    if (!actionTarget) return;
    const entry = actionTarget;
    setActionTarget(null);
    void copyEntryPath(entry);
  };

  const handleActionShare = () => {
    if (!actionTarget) return;
    const entry = actionTarget;
    setActionTarget(null);
    shareEntry(entry);
  };

  const currentFolderEntry = useMemo<WorkspaceEntry | null>(() => {
    if (!currentDir) return null;
    return {
      name: fileName(currentDir),
      path: currentDir,
      isDirectory: true,
    };
  }, [currentDir]);

  const requestFolderShare = (entry: WorkspaceEntry) => {
    setConfirmFolderShare(buildShareRequest(entry, scope));
  };

  const confirmShareFolder = () => {
    if (!confirmFolderShare) return;
    setShareTarget(confirmFolderShare);
    setConfirmFolderShare(null);
  };

  const goBack = () => {
    if (currentDir) {
      setCurrentDir(parentWorkspaceDir(currentDir));
      return;
    }
    router.back();
  };

  const entries = query.data ?? [];
  const refreshing = query.isFetching && !query.isLoading;
  const listBottomPadding = floatingBottomPadding(0) + spacing.xxl;

  if (!configured) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
        <FloatingHeader title={labels.title} onBack={() => router.back()} />
        <View style={styles.center}>
          <Icon source="cloud-off-outline" size={42} color={colors.text.tertiary} />
          <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{labels.gatewayRequiredTitle}</Text>
          <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>{labels.gatewayRequiredHint}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <FloatingHeader
        title={labels.title}
        onBack={goBack}
        rightActions={currentFolderEntry ? [
          {
            icon: 'folder-upload-outline',
            onPress: () => requestFolderShare(currentFolderEntry),
            accessibilityLabel: labels.shareCurrentFolder,
          },
        ] : undefined}
      />
      <View style={styles.breadcrumbWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.breadcrumbContent}>
          {breadcrumbs.map((crumb, index) => {
            const active = crumb.path === currentDir;
            return (
              <View key={crumb.path || 'root'} style={styles.crumbGroup}>
                {index > 0 ? <Icon source="chevron-right" size={14} color={colors.text.tertiary} /> : null}
                <Pressable
                  style={[styles.crumb, { backgroundColor: active ? colors.accent.selectionBg : colors.surface.input }]}
                  onPress={() => setCurrentDir(crumb.path)}
                  disabled={active}
                >
                  <Text numberOfLines={1} style={[styles.crumbText, { color: active ? colors.accent.primary : colors.text.secondary }]}>
                    {crumb.label}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      </View>

      {query.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>{m.common.loading}</Text>
        </View>
      ) : query.error ? (
        <View style={styles.center}>
          <Icon source="alert-circle-outline" size={42} color={colors.semantic.error} />
          <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{labels.loadFailed}</Text>
          <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>
            {query.error instanceof Error ? query.error.message : String(query.error)}
          </Text>
          <Pressable
            style={[styles.retryButton, { borderColor: colors.border.default, backgroundColor: colors.surface.panel }]}
            onPress={() => void query.refetch()}
          >
            <Text style={[styles.retryText, { color: colors.text.primary }]}>{m.common.retry}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.path}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void query.refetch()} />}
          contentContainerStyle={[styles.list, { paddingBottom: listBottomPadding }]}
          ListEmptyComponent={(
            <View style={styles.centerInline}>
              <Icon source="folder-open-outline" size={40} color={colors.text.tertiary} />
              <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>{labels.emptyTitle}</Text>
              <Text style={[styles.emptyText, { color: colors.text.tertiary }]}>{labels.emptyHint}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <FileRow
              entry={item}
              subtitle={entrySubtitle(item, labels)}
              onPress={() => openEntry(item)}
              onLongPress={() => setActionTarget(item)}
            />
          )}
        />
      )}

      <FilePreviewModal
        visible={Boolean(activeFile)}
        file={activeFile}
        sessionKey={scope.kind === 'session' ? scope.sessionKey : undefined}
        agentId={scope.kind === 'agent' ? scope.agentId : undefined}
        onClose={() => setActiveFile(null)}
      />
      <ShareSheet
        visible={Boolean(shareTarget)}
        request={shareTarget}
        onClose={() => setShareTarget(null)}
      />
      <FileActionSheet
        entry={actionTarget}
        visible={Boolean(actionTarget)}
        onDismiss={() => setActionTarget(null)}
        onCopy={handleActionCopy}
        onShare={handleActionShare}
      />
      <FolderShareConfirmSheet
        visible={Boolean(confirmFolderShare)}
        request={confirmFolderShare}
        onDismiss={() => setConfirmFolderShare(null)}
        onConfirm={confirmShareFolder}
      />
      <AppToast visible={Boolean(toast)} onDismiss={() => setToast('')} duration={TOAST_DURATION_SHORT}>
        {toast}
      </AppToast>
    </View>
  );
}

function FileRow({
  entry,
  subtitle,
  onPress,
  onLongPress,
}: {
  entry: WorkspaceEntry;
  subtitle: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { colors } = useTheme();
  const labels = useMessages().filesPage;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.surface.panel, borderColor: colors.border.default },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={LIST_DELAY_LONG_PRESS}
      accessibilityRole="button"
      accessibilityLabel={entry.isDirectory ? labels.openFolder : labels.openFile}
    >
      <View style={[styles.iconTile, { backgroundColor: colors.accent.selectionBg }]}>
        <Icon source={entryIcon(entry)} size={21} color={colors.accent.primary} />
      </View>
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text.primary }]}>
          {entry.name}
        </Text>
        <Text numberOfLines={1} style={[styles.rowSubtitle, { color: colors.text.tertiary }]}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

function FileActionSheet({
  entry,
  visible,
  onDismiss,
  onCopy,
  onShare,
}: {
  entry: WorkspaceEntry | null;
  visible: boolean;
  onDismiss: () => void;
  onCopy: () => void;
  onShare: () => void;
}) {
  const { colors, isDark } = useTheme();
  const labels = useMessages().filesPage;
  const displayName = entry?.name || (entry ? fileName(entry.path) : '');
  const actionTileBg = isDark ? colors.surface.input : colors.surface.hover;

  return (
    <BottomSheetModal
      visible={visible}
      onDismiss={onDismiss}
      title={displayName || labels.fileActions}
      subtitle={entry?.path}
      maxHeight="45%"
    >
      <View style={styles.actionSheetBody}>
        <Pressable
          style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]}
          onPress={onCopy}
          accessibilityRole="button"
          accessibilityLabel={labels.copyPath}
        >
          <View style={[styles.sheetActionIcon, { backgroundColor: actionTileBg }]}>
            <Icon source="content-copy" size={22} color={colors.text.secondary} />
          </View>
          <Text style={[styles.sheetActionText, { color: colors.text.primary }]}>{labels.copyPath}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]}
          onPress={onShare}
          accessibilityRole="button"
          accessibilityLabel={entry?.isDirectory ? labels.shareFolder : labels.share}
        >
          <View style={[styles.sheetActionIcon, { backgroundColor: actionTileBg }]}>
            <Icon source="share-variant" size={22} color={colors.text.secondary} />
          </View>
          <Text style={[styles.sheetActionText, { color: colors.text.primary }]}>
            {entry?.isDirectory ? labels.shareFolder : labels.share}
          </Text>
        </Pressable>
      </View>
    </BottomSheetModal>
  );
}

function FolderShareConfirmSheet({
  visible,
  request,
  onDismiss,
  onConfirm,
}: {
  visible: boolean;
  request: ShareAutoRequest | null;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const { colors } = useTheme();
  const m = useMessages();
  const labels = m.filesPage;
  const displayPath = request?.path ?? '';
  const displayName = fileName(displayPath) || labels.root;

  return (
    <BottomSheetModal
      visible={visible}
      onDismiss={onDismiss}
      title={labels.shareFolderConfirmTitle}
      subtitle={labels.shareFolderConfirmSubtitle}
      maxHeight="55%"
      footer={(
        <View style={styles.confirmFooter}>
          <Pressable
            style={[styles.secondaryButton, { borderColor: colors.border.default }]}
            onPress={onDismiss}
            accessibilityRole="button"
          >
            <Text style={[styles.secondaryButtonText, { color: colors.text.primary }]}>{m.common.cancel}</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: colors.accent.primary }]}
            onPress={onConfirm}
            accessibilityRole="button"
          >
            <Text style={[styles.primaryButtonText, { color: colors.accent.onPrimary }]}>{labels.shareFolderConfirmAction}</Text>
          </Pressable>
        </View>
      )}
    >
      <View style={styles.confirmBody}>
        <View style={[styles.confirmIconTile, { backgroundColor: colors.accent.selectionBg }]}>
          <Icon source="folder-outline" size={24} color={colors.accent.primary} />
        </View>
        <View style={styles.confirmCopy}>
          <Text numberOfLines={1} style={[styles.confirmTitle, { color: colors.text.primary }]}>
            {displayName}
          </Text>
          <Text numberOfLines={2} style={[styles.confirmPath, { color: colors.text.tertiary }]}>
            {displayPath || labels.root}
          </Text>
        </View>
      </View>
      <View style={[styles.confirmNotice, { backgroundColor: colors.surface.input, borderColor: colors.border.subtle }]}>
        <Text style={[styles.confirmNoticeText, { color: colors.text.secondary }]}>
          {labels.shareFolderConfirmNotice}
        </Text>
        <Text style={[styles.confirmNoticeText, { color: colors.text.tertiary }]}>
          {labels.shareFolderConfirmMode}
        </Text>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  breadcrumbWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  breadcrumbContent: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingRight: spacing.lg,
  },
  crumbGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  crumb: {
    maxWidth: 160,
    minHeight: 34,
    justifyContent: 'center',
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
  },
  crumbText: { ...typography.caption, fontWeight: '600' },
  list: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  pressed: { opacity: 0.74 },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: { ...typography.ui, fontWeight: '600' },
  rowSubtitle: { ...typography.caption },
  actionSheetBody: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  sheetAction: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  sheetActionIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetActionText: { ...typography.ui, fontWeight: '600' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  centerInline: {
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: { ...typography.heading, textAlign: 'center' },
  emptyText: { ...typography.label, textAlign: 'center' },
  retryButton: {
    minHeight: 44,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  retryText: { ...typography.ui, fontWeight: '600' },
  confirmBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  confirmIconTile: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  confirmTitle: { ...typography.ui, fontWeight: '600' },
  confirmPath: { ...typography.caption },
  confirmNotice: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.xs,
  },
  confirmNoticeText: { ...typography.label },
  confirmFooter: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: spacing.xs,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: { ...typography.ui, fontWeight: '600' },
  primaryButtonText: { ...typography.ui, fontWeight: '600' },
});
