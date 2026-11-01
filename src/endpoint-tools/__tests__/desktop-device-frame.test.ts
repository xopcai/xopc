import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { type ClientEndpointMessage } from '@xopcai/endpoint-tools-protocol';
import { expect, it } from 'vitest';

import { DesktopDeviceFrameSigner, DesktopDeviceFrameVerifier } from '../desktop-device-frame.js';

const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const binding = { gatewayId: randomUUID(), deviceId: randomUUID(), clientId: randomUUID(), connectionInstanceId: randomUUID(), authorizationRevision: 7 };
const frame = (): ClientEndpointMessage => ({ protocolVersion: 2, messageId: randomUUID(), type: 'tool.result', sentAt: Date.now(),
  payload: { invocationId: randomUUID(), content: [{ type: 'text', text: 'Synthetic result' }] } });

it('authenticates results and rejects replay, reordering and altered results without consuming a valid sequence', () => {
  const signer = new DesktopDeviceFrameSigner(binding, privateKey), verifier = new DesktopDeviceFrameVerifier(binding, publicKey);
  const message = frame(), first = signer.sign(message), second = signer.sign(frame());
  expect(() => verifier.verify(second)).toThrow('DESKTOP_DEVICE_FRAME_INVALID');
  const tampered = JSON.parse(first); tampered.message.payload.content[0].text = 'forged success';
  expect(() => verifier.verify(JSON.stringify(tampered))).toThrow('DESKTOP_DEVICE_FRAME_INVALID');
  expect(verifier.verify(first)).toEqual(message);
  expect(() => verifier.verify(first)).toThrow('DESKTOP_DEVICE_FRAME_INVALID');
  expect(verifier.verify(second).type).toBe('tool.result');
  signer.close(); expect(() => signer.sign(frame())).toThrow('DESKTOP_DEVICE_FRAME_SIGNER_CLOSED');
});

it('binds results to the exact device, Gateway, client, connection and authorization generation', () => {
  const wire = new DesktopDeviceFrameSigner(binding, privateKey).sign(frame());
  for (const key of Object.keys(binding)) {
    const changed = { ...binding, [key]: key === 'authorizationRevision' ? 8 : randomUUID() };
    expect(() => new DesktopDeviceFrameVerifier(changed, publicKey).verify(wire)).toThrow('DESKTOP_DEVICE_FRAME_INVALID');
  }
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  expect(() => new DesktopDeviceFrameVerifier(binding, other.publicKey.export({ type: 'spki', format: 'pem' }).toString()).verify(wire)).toThrow();
});

it('rejects stale/future, unsigned, malformed, oversized and falsely signed frames', () => {
  const message = frame(), signer = new DesktopDeviceFrameSigner(binding, privateKey);
  const wire = signer.sign(message), verifier = new DesktopDeviceFrameVerifier(binding, publicKey);
  for (const now of [message.sentAt - 60001, message.sentAt + 60001, NaN]) expect(() => verifier.verify(wire, now)).toThrow();
  expect(() => verifier.verify(JSON.stringify(message))).toThrow();
  expect(() => verifier.verify(' '.repeat(768 * 1024 + 1))).toThrow();
  const forged = JSON.parse(wire); forged.deviceProof.signature = 'A'.repeat(86);
  expect(() => verifier.verify(JSON.stringify(forged))).toThrow();
  // Even a key holder cannot smuggle an unknown protocol field through a valid signature.
  const payload = JSON.parse(Buffer.from(forged.deviceProof.signedPayload, 'base64url').toString());
  payload.message.unexpected = true;
  forged.message.unexpected = true;
  forged.deviceProof.signedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  forged.deviceProof.signature = sign('sha256', Buffer.from(forged.deviceProof.signedPayload), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  expect(() => verifier.verify(JSON.stringify(forged))).toThrow();
  expect(verifier.verify(wire)).toEqual(message);
});

it('rejects other key algorithms instead of silently changing proof algorithms', () => {
  for (const keys of [generateKeyPairSync('ed25519'), generateKeyPairSync('ec', { namedCurve: 'secp384r1' })]) {
    expect(() => new DesktopDeviceFrameSigner(binding, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())).toThrow('DESKTOP_DEVICE_KEY_INVALID');
    expect(() => new DesktopDeviceFrameVerifier(binding, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString())).toThrow('DESKTOP_DEVICE_KEY_INVALID');
  }
});
