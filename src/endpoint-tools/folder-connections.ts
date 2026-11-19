import { DEVICE_FOLDER_SEARCH, isDeviceFolderTool, type DeviceFolderGrant, type DeviceFolderSnapshot, type TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import type { GatewayPrincipal } from '../gateway/security/gateway-principal.js';
import { getDevice } from '../storage/sqlite/device-access-repository.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import type { EndpointConnectionSnapshot, EndpointRegistry } from './registry.js';

export const deviceFolderSnapshots = new DurableState<DeviceFolderSnapshot>('device.folder-connections');
export const mobileFolderPlatforms = new Set(['ios', 'android', 'harmonyos']);

export function saveDeviceFolderSnapshot(principalId: string, snapshot: DeviceFolderSnapshot): boolean {
  return deviceFolderSnapshots.update(principalId, previous => {
    if (previous && (previous.revision > snapshot.revision
      || previous.revision === snapshot.revision && JSON.stringify(previous.folders) !== JSON.stringify(snapshot.folders))) {
      return { value: previous, result: false };
    }
    return { value: snapshot, result: true };
  });
}

export function deviceFoldersFor(endpoint: EndpointConnectionSnapshot, actor: GatewayPrincipal | undefined,
  origin?: TurnOrigin, registry?: EndpointRegistry): DeviceFolderGrant[] {
  if (!actor || endpoint.kind !== 'desktop' || !endpoint.tools.some(tool => tool.descriptor.name === DEVICE_FOLDER_SEARCH)
    || !isXopcDatabaseOpen()) return [];
  const folders = deviceFolderSnapshots.get(endpoint.principalId)?.folders ?? [];
  if (actor.kind === 'owner' && actor.scopes.includes('gateway.admin')) {
    if (origin?.type !== 'endpoint' || registry?.get(origin.endpointId)?.principalId !== endpoint.principalId) return [];
    return folders;
  }
  if (actor.kind !== 'device' || !actor.deviceId) return [];
  if (origin && (origin.type !== 'endpoint' || registry?.get(origin.endpointId)?.principalId !== actor.deviceId)) return [];
  const device = getDevice(actor.deviceId);
  if (!device || device.revokedAt !== undefined || !mobileFolderPlatforms.has(device.platform)) return [];
  return folders.filter(folder => folder.mobileIds.includes(device.id));
}

export function permitsFolderInvocation(endpoint: EndpointConnectionSnapshot, actor: GatewayPrincipal | undefined,
  origin: TurnOrigin, registry: EndpointRegistry, toolName: string, args: Record<string, unknown>): boolean {
  return !isDeviceFolderTool(toolName)
    || deviceFoldersFor(endpoint, actor, origin, registry).some(folder => folder.id === args.folderId);
}
