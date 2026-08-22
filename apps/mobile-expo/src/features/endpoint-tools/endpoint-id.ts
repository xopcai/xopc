import { randomUUID } from 'expo-crypto';

import { KEYS, storage } from '../../storage/mmkv';

let currentEndpointId: string | undefined;

export function getMobileEndpointId(principalId: string): string {
  if (currentEndpointId?.startsWith(`${principalId}:`)) return currentEndpointId;
  const stored = storage.getString(KEYS.endpointId);
  if (stored?.startsWith(`${principalId}:`)) {
    currentEndpointId = stored;
    return stored;
  }
  currentEndpointId = `${principalId}:${randomUUID()}`;
  storage.set(KEYS.endpointId, currentEndpointId);
  return currentEndpointId;
}
