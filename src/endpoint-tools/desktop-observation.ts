import { createPublicKey } from 'node:crypto';

import { DESKTOP_STATE_OBSERVATION_TOOL, DESKTOP_SCREEN_OBSERVATION_TOOL } from '@xopcai/gateway-contract';
import type { EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';

import type { DeviceRecord } from '../storage/sqlite/device-access-repository.js';

export function desktopDeviceEndpointKey(device: Pick<DeviceRecord, 'publicKeyJwk'>): string {
  return createPublicKey({ key: device.publicKeyJwk, format: 'jwk' }).export({ type: 'spki', format: 'der' }).toString('base64url');
}

export function assertDesktopObservationHello(device: DeviceRecord, hello: EndpointHelloPayload, registeredKey: string | undefined): void {
  const allowed = [
    ...(device.scopes.includes('desktop.observe.state') ? [DESKTOP_STATE_OBSERVATION_TOOL] : []),
    ...(device.scopes.includes('desktop.observe.screen') ? [DESKTOP_SCREEN_OBSERVATION_TOOL] : []),
  ];
  if (device.platform !== 'desktop' || device.revokedAt !== undefined
    || hello.principalId !== device.id || hello.kind !== 'desktop' || hello.platform !== 'desktop'
    || registeredKey !== desktopDeviceEndpointKey(device)
    || hello.tools.length !== 1 || !allowed.includes(hello.tools[0]?.name as typeof allowed[number])) {
    throw new Error('DESKTOP_OBSERVATION_DENIED');
  }
}
