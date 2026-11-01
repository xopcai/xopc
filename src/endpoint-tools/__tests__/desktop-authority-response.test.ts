import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { expect, it } from 'vitest';

import { signDesktopAuthorityResponse, verifyDesktopAuthorityResponse } from '../desktop-authority-response.js';

it('binds grant acknowledgements to the device, Gateway, nonce, method, target, status and exact response body', () => {
  const keys = generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const binding = { gatewayId: randomUUID(), deviceId: randomUUID(), nonce: randomUUID(), method: 'POST', target: '/api/desktop-host/execution' };
  const body = { ok: true, payload: { active: true, revision: 1 } };
  const response = { status: 200, body: signDesktopAuthorityResponse(body, binding, 200, payload => sign(null, Buffer.from(payload), keys.privateKey).toString('base64url')) };
  expect(verifyDesktopAuthorityResponse(response, binding, publicKey)).toEqual(body);
  for (const name of Object.keys(binding)) expect(() => verifyDesktopAuthorityResponse(response, { ...binding, [name]: 'another-request' }, publicKey)).toThrow('AUTHORITY_RESPONSE_INVALID');
  expect(() => verifyDesktopAuthorityResponse({ ...response, status: 201 }, binding, publicKey)).toThrow();
  expect(() => verifyDesktopAuthorityResponse({ ...response, body: { ...response.body, payload: { active: false, revision: 9 } } }, binding, publicKey)).toThrow();
  const sentAt = JSON.parse(Buffer.from(response.body.authorityProof.signedPayload, 'base64url').toString()).sentAt;
  expect(() => verifyDesktopAuthorityResponse(response, binding, publicKey, sentAt + 60001)).toThrow();
  expect(() => verifyDesktopAuthorityResponse({ status: 200, body }, binding, publicKey)).toThrow();
});
