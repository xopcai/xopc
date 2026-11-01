import { endpointDesktopExecutionAuthoritySchema, type EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';

import type { DeviceRecord } from '../storage/sqlite/device-access-repository.js';
import { getDesktopExecutionGrant } from '../storage/sqlite/desktop-execution-repository.js';
import { desktopDeviceEndpointKey } from './desktop-observation.js';
import { endpointToolRevision } from './registry.js';

/** Only the authenticated device and its exact, still-active local grant may register an executor. */
export function assertDesktopExecutionHello(device: DeviceRecord, hello: EndpointHelloPayload, registeredKey: string | undefined,
  gatewayId: string, clientId: string, capabilities: readonly string[], now = Date.now()) {
  const snapshot = getDesktopExecutionGrant(device.id, now), grant = snapshot?.grant, execution = hello.execution;
  if (device.platform !== 'desktop' || device.revokedAt !== undefined || !device.scopes.includes('desktop.execute')
    || hello.principalId !== device.id || hello.kind !== 'desktop' || hello.platform !== 'desktop'
    || registeredKey !== desktopDeviceEndpointKey(device) || !snapshot?.active || !grant || !execution
    || execution.grantId !== grant.grantId || execution.expiresAt !== grant.expiresAt || execution.authorizationRevision !== snapshot.revision
    || hello.deviceFrames?.version !== 1 || hello.deviceFrames.authorizationRevision !== snapshot.revision
    || !capabilities.includes('desktop.device-frames.v1') || !capabilities.includes('desktop.durable-execution.v1')
    || hello.tools.some(tool => tool.name === 'desktop.operation.get_status') && !capabilities.includes('desktop.operation-status.v1')
    || Boolean(hello.terminal) !== Boolean(grant.toolRevisions['desktop.terminal.open'])
    || hello.terminal && !capabilities.includes('desktop.terminal.v1')
    || hello.tools.length !== Object.keys(grant.toolRevisions).length
    || new Set(hello.tools.map(tool => tool.name)).size !== hello.tools.length
    || hello.tools.some(tool => grant.toolRevisions[tool.name as keyof typeof grant.toolRevisions] !== endpointToolRevision(tool))) {
    throw new Error('DESKTOP_EXECUTION_DENIED');
  }
  return endpointDesktopExecutionAuthoritySchema.parse({ gatewayId, deviceId: device.id, clientId,
    connectionInstanceId: hello.connectionInstanceId, authorizationRevision: snapshot.revision, grantId: grant.grantId, expiresAt: grant.expiresAt,
    ...(grant.workspaceId ? { workspaceId: grant.workspaceId } : {}), ...(capabilities.includes('desktop.operation-status.v1') ? { operationStatus: true } : {}) });
}
