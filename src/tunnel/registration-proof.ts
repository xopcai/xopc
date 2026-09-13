import { randomBytes } from 'node:crypto';
import { getGatewayIdentityPublicKeyRaw, getOrCreateGatewayIdentity, signGatewayPayload } from '../storage/sqlite/gateway-identity-repository.js';

/** Canonical v2 registration proof, shared with the Broker protocol test vectors. */
export function createTunnelRegistrationProof(input: {
  brokerUrl: string; platform: string; gatewayVersion: string; preferredSubdomain?: string; recoveryToken?: string;
}) {
  const identity = getOrCreateGatewayIdentity();
  const publicKey = getGatewayIdentityPublicKeyRaw(identity);
  const nonce = randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + 120_000;
  const audience = input.brokerUrl.replace(/\/+$/, '');
  const payload = JSON.stringify(['xopc-tunnel-registration-v2', audience, identity.id, publicKey,
    input.platform, input.gatewayVersion, input.preferredSubdomain ?? '', input.recoveryToken ?? '', nonce, expiresAt]);
  return { version: 2, gatewayId: identity.id, publicKey, platform: input.platform, gatewayVersion: input.gatewayVersion,
    preferredSubdomain: input.preferredSubdomain, recoveryToken: input.recoveryToken, nonce, expiresAt, signature: signGatewayPayload(payload) };
}
