import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { NativeScreenHeader } from '@/components/NativeScreenHeader';
import { FilePreviewModal, type PreviewableFile } from '@/features/file-preview/FilePreviewModal';
import { useMessages } from '@/i18n/messages';
import {
  fetchDefaultFileSpace,
  fetchFileSpaceForContext,
  resolveFileResource,
} from '@/query/files';
import { useTheme } from '@/theme';

import { FileListSkeleton, FileLoadError } from './FilesScreen';

export function WorkspaceFileLinkScreen({
  path,
  sessionKey,
}: {
  path: string;
  sessionKey?: string;
}) {
  const router = useRouter();
  const labels = useMessages().filesPage;
  const { colors } = useTheme();
  const normalizedPath = path.trim();
  const normalizedSessionKey = sessionKey?.trim();
  const file = useQuery({
    queryKey: ['files', 'workspace-link', normalizedSessionKey ?? 'default', normalizedPath],
    queryFn: async () => {
      const space = normalizedSessionKey
        ? await fetchFileSpaceForContext('session', normalizedSessionKey)
        : await fetchDefaultFileSpace();
      return resolveFileResource(space.id, normalizedPath);
    },
    enabled: Boolean(normalizedPath),
  });
  const preview = useMemo<PreviewableFile | null>(() => {
    if (file.data?.kind !== 'file') return null;
    return {
      fileId: file.data.id,
      name: file.data.name,
      mimeType: file.data.mimeType,
      workspaceRelativePath: file.data.relativePath,
    };
  }, [file.data]);
  const error = !normalizedPath || (file.data && file.data.kind !== 'file')
    ? new Error(labels.locationUnavailable)
    : file.error;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      {!preview ? <NativeScreenHeader title={labels.title} onBack={() => router.back()} /> : null}
      {file.isLoading ? (
        <FileListSkeleton />
      ) : !preview ? (
        <FileLoadError error={error} onRetry={() => void file.refetch()} />
      ) : null}
      <FilePreviewModal
        visible={Boolean(preview)}
        file={preview}
        onClose={() => router.back()}
      />
    </View>
  );
}
