import { useLocalSearchParams } from 'expo-router';

import { FileSpaceBrowserRouteScreen } from '@/features/files/FilesScreen';

export default function FileSpaceRoute() {
  const { spaceId = '' } = useLocalSearchParams<{ spaceId?: string }>();
  return <FileSpaceBrowserRouteScreen spaceId={spaceId} />;
}
