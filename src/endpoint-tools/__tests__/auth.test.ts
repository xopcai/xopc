import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  endpointHelloSigningPayload,
  type EndpointHelloPayload,
} from '@xopcai/endpoint-tools-protocol';

import { EndpointAuthenticator } from '../auth.js';
import type { EndpointPrincipal } from '../../storage/sqlite/index.js';

function signedHello(now: number): { payload: EndpointHelloPayload; principal: EndpointPrincipal } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const principal: EndpointPrincipal = {
    id: 'principal-1',
    kind: 'web',
    displayName: 'Browser tab',
    platform: 'web',
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    createdAt: now,
  };
  const payload: EndpointHelloPayload = {
    principalId: principal.id,
    endpointId: 'tab-1',
    connectionInstanceId: crypto.randomUUID(),
    displayName: principal.displayName,
    kind: principal.kind,
    platform: principal.platform,
    appVersion: '1',
    availability: 'foreground',
    nonce: 'nonce-1',
    signedAt: now,
    signature: 'pending-signature',
    tools: [],
  };
  payload.signature = crypto.sign(
    'sha256',
    Buffer.from(endpointHelloSigningPayload(payload)),
    { key: privateKey, dsaEncoding: 'ieee-p1363' },
  ).toString('base64url');
  return { payload, principal };
}

describe('EndpointAuthenticator', () => {
  it('verifies P-256 hello signatures and rejects nonce replay', () => {
    const now = 10_000;
    const { payload, principal } = signedHello(now);
    const touchPrincipal = vi.fn();
    const bindEndpoint = vi.fn(() => true);
    const authenticator = new EndpointAuthenticator({
      getPrincipal: () => principal,
      bindEndpoint,
      touchPrincipal,
      now: () => now,
    });

    expect(authenticator.authenticate(payload)).toEqual(principal);
    expect(touchPrincipal).toHaveBeenCalledWith(principal.id, now);
    expect(bindEndpoint).toHaveBeenCalledWith(payload.endpointId, principal.id, now);
    expect(() => authenticator.authenticate(payload)).toThrow(/nonce/);
  });

  it('rejects identity mismatches', () => {
    const now = 10_000;
    const { payload, principal } = signedHello(now);
    const authenticator = new EndpointAuthenticator({
      getPrincipal: () => ({ ...principal, kind: 'desktop' }),
      bindEndpoint: vi.fn(() => true),
      touchPrincipal: vi.fn(),
      now: () => now,
    });
    expect(() => authenticator.authenticate(payload)).toThrow(/does not match/);
  });

  it('rejects endpoint instances bound to another principal', () => {
    const now = 10_000;
    const { payload, principal } = signedHello(now);
    const authenticator = new EndpointAuthenticator({
      getPrincipal: () => principal,
      bindEndpoint: () => false,
      touchPrincipal: vi.fn(),
      now: () => now,
    });
    expect(() => authenticator.authenticate(payload)).toThrow(/another principal/);
  });
});
