import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { deviceStateDescriptor, type EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';
import { expect, it } from 'vitest';

import { signDesktopGatewayFrame, verifyDesktopGatewayFrame } from '../desktop-frame.js';
import { assertDesktopObservationHello, desktopDeviceEndpointKey } from '../desktop-observation.js';
import type { DeviceRecord } from '../../storage/sqlite/device-access-repository.js';

const gateway = generateKeyPairSync('ed25519'), deviceKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = gateway.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const binding = { gatewayId: randomUUID(), deviceId: randomUUID(), clientId: randomUUID(), connectionInstanceId: randomUUID() };
const frame = { protocolVersion: 2, kind: 'endpoint.message', messageId: randomUUID(), sentAt: Date.now(), payload: { type: 'tool.invoke' } };
const signed = () => signDesktopGatewayFrame(frame, binding, 1, payload => sign(null, Buffer.from(payload), gateway.privateKey).toString('base64url'));
it('binds a signed command to its Gateway, device, client, instance, time and sequence', () => {
  const wire = JSON.stringify(signed()); expect(verifyDesktopGatewayFrame(wire, binding, publicKey, 0).sequence).toBe(1);
  expect(() => verifyDesktopGatewayFrame(wire, binding, publicKey, 1)).toThrow('DESKTOP_GATEWAY_FRAME_INVALID');
  for (const key of Object.keys(binding)) expect(() => verifyDesktopGatewayFrame(wire, { ...binding, [key]: randomUUID() }, publicKey, 0)).toThrow();
  expect(() => verifyDesktopGatewayFrame(wire, binding, publicKey, 0, frame.sentAt + 60001)).toThrow();
  expect(() => verifyDesktopGatewayFrame(JSON.stringify({ ...signed(), payload: { type: 'other' } }), binding, publicKey, 0)).toThrow();
  expect(() => verifyDesktopGatewayFrame(JSON.stringify(frame), binding, publicKey, 0)).toThrow();
});
it('requires the independently paired device key, explicit observation grant and exact tool allowlist', () => {
  const device: DeviceRecord = { id: binding.deviceId, displayName: 'Synthetic desktop', platform: 'desktop', publicKeyJwk: deviceKeys.publicKey.export({ format: 'jwk' }),
    requestProofVersion: 1, scopes: ['device.self', 'desktop.observe.state'], createdAt: Date.now() };
  const hello: EndpointHelloPayload = { principalId: device.id, endpointId: randomUUID(), connectionInstanceId: randomUUID(), kind: 'desktop', platform: 'desktop',
    displayName: device.displayName, appVersion: '1', availability: 'background', nonce: randomUUID(), signedAt: Date.now(), signature: 'pending', tools: [deviceStateDescriptor('desktop', 'state')] };
  const key = desktopDeviceEndpointKey(device);
  expect(() => assertDesktopObservationHello(device, hello, key)).not.toThrow();
  for (const changed of [{ ...device, scopes: ['device.self'] }, { ...device, revokedAt: Date.now() }, { ...device, id: randomUUID() }]) expect(() => assertDesktopObservationHello(changed as DeviceRecord, hello, key)).toThrow();
  expect(() => assertDesktopObservationHello(device, hello, 'another-key')).toThrow();
  for (const tools of [[], [deviceStateDescriptor('desktop', 'power')], [hello.tools[0], { ...hello.tools[0], name: 'desktop.file.save', effect: 'read' as const }]]) {
    expect(() => assertDesktopObservationHello(device, { ...hello, tools }, key)).toThrow();
  }
});
