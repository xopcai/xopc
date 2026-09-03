import {
  executionHostHelloSigningPayload,
  executionHostTicketSigningPayload,
  type ExecutionHostHelloPayload,
  type ExecutionHostTicketRequest,
} from '@xopcai/realtime-protocol';

import { verifyP256Signature } from '../crypto/p256.js';
import { getExecutionHost, type ExecutionHost } from './repository.js';

const MAX_CLOCK_SKEW_MS = 60_000;

export class ExecutionHostAuthenticationError extends Error {}

export class ExecutionHostAuthenticator {
  private readonly usedNonces = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  authenticateTicket(payload: ExecutionHostTicketRequest): ExecutionHost {
    return this.authenticate(
      payload.hostId,
      payload.nonce,
      payload.signedAt,
      payload.signature,
      executionHostTicketSigningPayload(payload),
      'ticket',
    );
  }

  authenticateHello(payload: ExecutionHostHelloPayload): ExecutionHost {
    const host = this.authenticate(
      payload.hostId,
      payload.nonce,
      payload.signedAt,
      payload.signature,
      executionHostHelloSigningPayload(payload),
      'hello',
    );
    if (host.platform !== payload.platform || host.arch !== payload.arch) {
      throw new ExecutionHostAuthenticationError('Execution host identity does not match enrollment');
    }
    return host;
  }

  private authenticate(
    hostId: string,
    nonce: string,
    signedAt: number,
    signature: string,
    signingPayload: string,
    purpose: string,
  ): ExecutionHost {
    const now = this.now();
    this.prune(now);
    if (Math.abs(now - signedAt) > MAX_CLOCK_SKEW_MS) {
      throw new ExecutionHostAuthenticationError('Execution host signature timestamp is outside the allowed window');
    }
    const nonceKey = `${purpose}:${hostId}:${nonce}`;
    if (this.usedNonces.has(nonceKey)) {
      throw new ExecutionHostAuthenticationError('Execution host nonce was already used');
    }
    const host = getExecutionHost(hostId);
    if (!host || host.lifecycleStatus === 'revoked') {
      throw new ExecutionHostAuthenticationError('Execution host is unknown or revoked');
    }
    let valid = false;
    try {
      valid = verifyP256Signature(host.publicKey, signingPayload, signature);
    } catch (error) {
      throw new ExecutionHostAuthenticationError('Execution host public key is invalid', { cause: error });
    }
    if (!valid) throw new ExecutionHostAuthenticationError('Execution host signature is invalid');
    this.usedNonces.set(nonceKey, now + MAX_CLOCK_SKEW_MS);
    return host;
  }

  private prune(now: number): void {
    for (const [nonce, expiresAt] of this.usedNonces) {
      if (expiresAt <= now) this.usedNonces.delete(nonce);
    }
  }
}
