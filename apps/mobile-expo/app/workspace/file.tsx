import { useLocalSearchParams } from 'expo-router';

import { WorkspaceFileLinkScreen } from '@/features/files/WorkspaceFileLinkScreen';

export default function WorkspaceFileLinkRoute() {
  const { path = '', sessionKey } = useLocalSearchParams<{ path?: string; sessionKey?: string }>();
  return <WorkspaceFileLinkScreen path={path} sessionKey={sessionKey} />;
}
