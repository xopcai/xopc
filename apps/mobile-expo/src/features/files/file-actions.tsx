import { useMutation } from '@tanstack/react-query';
import type { FileResource } from '@xopcai/gateway-contract';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { AppToast } from '../../components/AppToast';
import { BatchActionBar } from '../../components/BatchActionBar';
import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useListSelection } from '../../hooks/use-list-selection';
import { useMessages } from '../../i18n/messages';
import { fetchFileHostPath, resolveFileResource } from '../../query/files';
import { spacing, useTheme } from '../../theme';
import { setAppClipboardStringAsync } from '../clipboard-intake/write-app-clipboard';
import { ShareSheet } from '../share/ShareSheet';

export function useFileActions(items: FileResource[]) {
  const m = useMessages();
  const { colors } = useTheme();
  const selection = useListSelection<string>();
  const [toast, setToast] = useState('');
  const [folder, setFolder] = useState<FileResource | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const shareRequest = useMemo(() => shareId ? { fileId: shareId, audience: 'friend' as const } : null, [shareId]);
  const copy = useMutation({
    mutationFn: async (files: FileResource[]) => {
      const paths = await Promise.all(files.map((file) => fetchFileHostPath(file.id)));
      await setAppClipboardStringAsync(paths.join('\n'));
    },
    onSuccess: () => { setToast(m.filesPage.pathCopied); selection.exitSelectionMode(); },
    onError: () => setToast(m.filesPage.copyFailed),
  });
  const share = (file: FileResource) => {
    if (file.kind === 'directory') setFolder(file);
    else setShareId(file.id);
  };
  const shareDirectory = useMutation({
    mutationFn: ({ spaceId, path }: { spaceId: string; path: string }) => resolveFileResource(spaceId, path || '.'),
    onSuccess: share,
    onError: () => setToast(m.filesPage.loadFailed),
  });
  const selected = items.filter((file) => selection.selectedIds.has(file.id));

  return {
    ...selection,
    share,
    copyPath: (file: FileResource) => copy.mutate([file]),
    shareDirectory: (spaceId: string, path: string) => {
      if (!shareDirectory.isPending) shareDirectory.mutate({ spaceId, path });
    },
    overlays: <>
      {selection.selectionMode ? <BatchActionBar items={[
        { key: 'copy', icon: 'content-copy', label: m.filesPage.copyPath, disabled: !selected.length, loading: copy.isPending, onPress: () => copy.mutate(selected) },
        { key: 'share', icon: 'share-variant-outline', label: m.filesPage.share, disabled: selected.length !== 1, onPress: () => { if (selected[0]) share(selected[0]); } },
        { key: 'cancel', icon: 'close', label: m.common.cancel, onPress: selection.exitSelectionMode },
      ]} /> : null}
      <BottomSheetModal
        visible={Boolean(folder)}
        onDismiss={() => setFolder(null)}
        title={m.filesPage.shareFolderConfirmTitle}
        subtitle={m.filesPage.shareFolderConfirmSubtitle}
        footer={<Button mode="contained" onPress={() => {
          if (folder) setShareId(folder.id);
          setFolder(null);
          selection.exitSelectionMode();
        }}>{m.filesPage.shareFolderConfirmAction}</Button>}
      >
        <View style={styles.confirm}>
          <Text style={{ color: colors.text.primary }}>{folder?.relativePath || m.filesPage.root}</Text>
          <Text style={{ color: colors.text.secondary }}>{m.filesPage.shareFolderConfirmNotice}</Text>
          <Text style={{ color: colors.text.tertiary }}>{m.filesPage.shareFolderConfirmMode}</Text>
        </View>
      </BottomSheetModal>
      <ShareSheet visible={Boolean(shareId)} request={shareRequest} onClose={() => setShareId(null)} />
      <AppToast visible={Boolean(toast)} onDismiss={() => setToast('')}>{toast}</AppToast>
    </>,
  };
}

const styles = StyleSheet.create({ confirm: { gap: spacing.md, paddingVertical: spacing.lg } });
