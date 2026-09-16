import { useLocalSearchParams } from 'expo-router';

import { WorkspaceFileLinkScreen } from '@/features/files/WorkspaceFileLinkScreen';

export default function WorkspaceFileLinkRoute() {
  const { path = '', conversationId } = useLocalSearchParams<{ path?: string; conversationId?: string }>();
  return <WorkspaceFileLinkScreen path={path} conversationId={conversationId} />;
}
