import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { NativeScreenHeader } from '@/components/NativeScreenHeader';
import { FilePreviewModal } from '@/features/chat/FilePreviewModal';
import { FileListSkeleton, FileLoadError } from '@/features/files/FilesScreen';
import { useMessages } from '@/i18n/messages';
import { fetchFileResource } from '@/query/files';
import { useTheme } from '@/theme';

export default function FileOpenRoute() {
  const router = useRouter();
  const labels = useMessages().filesPage;
  const { colors } = useTheme();
  const { fileId = '' } = useLocalSearchParams<{ fileId?: string }>();
  const file = useQuery({ queryKey: ['files', 'resource', fileId], queryFn: () => fetchFileResource(fileId), enabled: Boolean(fileId) });
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      <NativeScreenHeader title={file.data?.name ?? labels.title} onBack={() => router.back()} />
      {file.isLoading ? <FileListSkeleton /> : !file.data ? <FileLoadError error={file.error} onRetry={() => void file.refetch()} /> : null}
      <FilePreviewModal
        visible={Boolean(file.data)}
        file={file.data ? { fileId: file.data.id, name: file.data.name, mimeType: file.data.mimeType, workspaceRelativePath: file.data.relativePath } : null}
        onClose={() => router.back()}
      />
    </View>
  );
}
