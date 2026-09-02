import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { FilePreviewModal } from '@/features/chat/FilePreviewModal';
import { fetchFileResource } from '@/query/files';

export default function FileOpenRoute() {
  const router = useRouter();
  const { fileId = '' } = useLocalSearchParams<{ fileId?: string }>();
  const file = useQuery({ queryKey: ['files', 'resource', fileId], queryFn: () => fetchFileResource(fileId), enabled: Boolean(fileId) });
  return (
    <View style={{ flex: 1 }}>
      <FilePreviewModal
        visible={Boolean(file.data)}
        file={file.data ? { fileId: file.data.id, name: file.data.name, mimeType: file.data.mimeType, workspaceRelativePath: file.data.relativePath } : null}
        onClose={() => router.back()}
      />
    </View>
  );
}
