import type { ResolvedGatewayAuth } from '../auth.js';

/**
 * Placeholder credentials that have shipped in `.env.example` or been used as
 * copy-paste examples in onboarding docs. If any of these becomes the resolved
 * gateway credential, reject it at startup. The operator almost certainly
 * copied an example file verbatim without replacing the sentinel, which would
 * otherwise leave the gateway protected by a publicly-known credential.
 */

export const KNOWN_WEAK_GATEWAY_TOKEN_PLACEHOLDERS = [
  'change-me-to-a-long-random-token',
  'change-me-now',
  'your-secret-token-here',
  'test-token',
  'my-token',
  'token',
  'secret',
  'password',
  '123456',
  'abc123',
] as const;

const KNOWN_WEAK_GATEWAY_TOKENS: ReadonlySet<string> = new Set(
  KNOWN_WEAK_GATEWAY_TOKEN_PLACEHOLDERS,
);

/**
 * Minimum acceptable token length. Short tokens are vulnerable to brute-force
 * even with rate limiting.
 */
const MIN_TOKEN_LENGTH = 16;

export function assertGatewayAuthNotKnownWeak(auth: ResolvedGatewayAuth): void {
  if (auth.mode !== 'token' || !auth.token) {
    return;
  }

  const token = auth.token.trim();

  if (KNOWN_WEAK_GATEWAY_TOKENS.has(token)) {
    throw new Error(
      'Invalid config: gateway auth token is set to a published example placeholder ' +
      'from docs or .env.example. Generate a real secret (e.g. `openssl rand -hex 32`) ' +
      'and set XOPC_GATEWAY_TOKEN or gateway.auth.token before starting the gateway.',
    );
  }

  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `Invalid config: gateway auth token is too short (${token.length} chars, minimum ${MIN_TOKEN_LENGTH}). ` +
      'Use a strong random token (e.g. `openssl rand -hex 32`).',
    );
  }
}
