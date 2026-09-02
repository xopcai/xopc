import { useLocalSearchParams } from 'expo-router';

import { ContextFileBrowserScreen } from '@/features/files/FilesScreen';
import type { FileContextKind } from '@/query/files';

export default function ContextFilesRoute() {
  const params = useLocalSearchParams<{ kind?: string; id?: string }>();
  return <ContextFileBrowserScreen kind={params.kind as FileContextKind} id={params.id ?? ''} />;
}
