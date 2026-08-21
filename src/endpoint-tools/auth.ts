import crypto from 'node:crypto';

import {
  endpointHelloSigningPayload,
  type EndpointHelloPayload,
} from '@xopcai/endpoint-tools-protocol';

import type { EndpointPrincipal } from '../storage/sqlite/index.js';

const MAX_CLOCK_SKEW_MS = 60_000;

export interface EndpointAuthenticatorDeps {
  getPrincipal(id: string): EndpointPrincipal | undefined;
  bindEndpoint(endpointId: string, principalId: string, boundAt?: number): boolean;
  touchPrincipal(id: string, seenAt?: number): void;
  now?: () => number;
}

export class EndpointAuthenticationError extends Error {}

export function parseEndpointPublicKey(encoded: string): crypto.KeyObject {
  const key = crypto.createPublicKey({
    key: Buffer.from(encoded, 'base64url'),
    format: 'der',
    type: 'spki',
  });
  if (
    key.asymmetricKeyType !== 'ec'
    || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  ) {
    throw new Error('Endpoint public key must be ECDSA P-256');
  }
  return key;
}

export class EndpointAuthenticator {
  private readonly usedNonces = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly deps: EndpointAuthenticatorDeps) {
    this.now = deps.now ?? Date.now;
  }

  authenticate(payload: EndpointHelloPayload): EndpointPrincipal {
    const now = this.now();
    this.pruneNonces(now);
    if (Math.abs(now - payload.signedAt) > MAX_CLOCK_SKEW_MS) {
      throw new EndpointAuthenticationError('Endpoint signature timestamp is outside the allowed window');
    }

    const nonceKey = `${payload.principalId}:${payload.nonce}`;
    if (this.usedNonces.has(nonceKey)) {
      throw new EndpointAuthenticationError('Endpoint hello nonce was already used');
    }

    const principal = this.deps.getPrincipal(payload.principalId);
    if (!principal || principal.revokedAt !== undefined) {
      throw new EndpointAuthenticationError('Endpoint principal is unknown or revoked');
    }
    if (
      principal.kind !== payload.kind
      || principal.platform !== payload.platform
      || principal.displayName !== payload.displayName
    ) {
      throw new EndpointAuthenticationError('Endpoint identity does not match its registered principal');
    }

    let publicKey: crypto.KeyObject;
    try {
      publicKey = parseEndpointPublicKey(principal.publicKey);
    } catch (error) {
      throw new EndpointAuthenticationError('Endpoint principal public key is invalid', { cause: error });
    }

    const valid = crypto.verify(
      'sha256',
      Buffer.from(endpointHelloSigningPayload(payload), 'utf8'),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(payload.signature, 'base64url'),
    );
    if (!valid) throw new EndpointAuthenticationError('Endpoint hello signature is invalid');

    if (!this.deps.bindEndpoint(payload.endpointId, principal.id, now)) {
      throw new EndpointAuthenticationError('Endpoint instance belongs to another principal');
    }

    this.usedNonces.set(nonceKey, now + MAX_CLOCK_SKEW_MS);
    this.deps.touchPrincipal(principal.id, now);
    return principal;
  }

  private pruneNonces(now: number): void {
    for (const [key, expiresAt] of this.usedNonces) {
      if (expiresAt <= now) this.usedNonces.delete(key);
    }
  }
}
