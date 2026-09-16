import { COMPUTER_DESCRIPTOR, COMPUTER_FRAME_MAX_BYTES } from '@xopcai/computer-control-contract';
import { ENDPOINT_PROTOCOL_VERSION } from '@xopcai/endpoint-tools-protocol';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import type { Hono } from 'hono';

export function registerEndpointCompatibilityRoutes(authenticated: Hono): void {
  authenticated.get('/api/endpoint-tools/compatibility', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, payload: {
      realtimeProtocolVersion: REALTIME_PROTOCOL_VERSION,
      endpointProtocolVersion: ENDPOINT_PROTOCOL_VERSION,
      computerControl: COMPUTER_DESCRIPTOR,
      computerFrameUploadMaxBytes: COMPUTER_FRAME_MAX_BYTES,
    } });
  });
}
