import { useSyncExternalStore } from 'react';

import {
  getWorkspaceSyncStatus,
  subscribeWorkspaceSyncStatus,
  type WorkspaceSyncStatus,
} from './workspace-sync';

export function useWorkspaceSyncStatus(): WorkspaceSyncStatus {
  return useSyncExternalStore(subscribeWorkspaceSyncStatus, getWorkspaceSyncStatus, getWorkspaceSyncStatus);
}
