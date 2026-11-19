import { COMPUTER_DESCRIPTOR, COMPUTER_FRAME_MAX_BYTES } from '@xopcai/computer-control-contract';
import { ENDPOINT_PROTOCOL_VERSION } from '@xopcai/endpoint-tools-protocol';
import { REALTIME_CAPABILITIES, REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import type { Hono } from 'hono';

import { isXopcDatabaseOpen } from '../../../storage/sqlite/connection.js';
import { getOrCreateGatewayIdentity } from '../../../storage/sqlite/gateway-identity-repository.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';

export function registerEndpointCompatibilityRoutes(authenticated: Hono): void {
  authenticated.get('/api/endpoint-tools/compatibility', (c) => {
    const principal = getGatewayPrincipal(c);
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload: {
      realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
      realtime: {
        minVersion: REALTIME_PROTOCOL_VERSION,
        maxVersion: REALTIME_PROTOCOL_VERSION,
        capabilities: REALTIME_CAPABILITIES,
      },
      turnDeviceContextV1: true,
      clarificationVersions: process.env.XOPC_CLARIFY_MULTI_QUESTION === 'false' ? [1] : [1, 2],
      endpointEnvironmentV1: true,
      ...(isXopcDatabaseOpen() ? { gatewayId: getOrCreateGatewayIdentity().id } : {}),
      locationSharingV1: true,
      mobilePhoneWorkspaceV1: true,
      phoneMediaProtocolVersion: 1,
      deviceStateToolsV1: true,
      hardwareBridgeV1: true,
      deviceProvidersV1: true,
      deviceLocationTasksV1: true,
      mobilePersonalToolsV1: true,
      mobileExtendedPersonalToolsV1: true,
      deviceFolderConnectionsV1: true,
      deviceFolderGatewayAccessV1: true,
      desktopCapabilityAccessV1: true,
      ...(principal.kind === 'device' ? { deviceId: principal.deviceId } : {}),
      endpointProtocolVersion: ENDPOINT_PROTOCOL_VERSION,
      computerControl: COMPUTER_DESCRIPTOR,
      computerFrameUploadMaxBytes: COMPUTER_FRAME_MAX_BYTES,
    } });
  });
}
