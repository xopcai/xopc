/**
 * OAuth API client - Async flow support
 */

export interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer?: boolean;
}

export interface OAuthStatus {
  configured: boolean;
  expires?: number;
}

export interface OAuthSessionStatus {
  sessionId: string;
  provider: string;
  status: 'pending' | 'waiting_auth' | 'waiting_code' | 'completed' | 'failed' | 'cancelled';
  authUrl?: string;
  instructions?: string;
  deviceCode?: string;
  verificationUri?: string;
  message?: string;
  error?: string;
  expiresAt: number;
}

export interface OAuthStartResult {
  sessionId: string;
  provider: string;
  status: string;
}

/**
 * Get list of available OAuth providers
 */
export async function fetchOAuthProviders(token?: string): Promise<OAuthProvider[]> {
  const response = await fetch(`${window.location.origin}/api/auth/oauth`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OAuth providers: ${response.status}`);
  }

  const data = await response.json();
  return data.payload.providers;
}

/**
 * Check OAuth status for a provider
 */
export async function fetchOAuthStatus(provider: string, token?: string): Promise<OAuthStatus> {
  const response = await fetch(`${window.location.origin}/api/auth/oauth/${provider}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OAuth status: ${response.status}`);
  }

  const data = await response.json();
  return data.payload;
}

/**
 * Start async OAuth login flow for a provider
 * Returns immediately with session ID
 */
export async function startAsyncOAuthLogin(provider: string, token?: string): Promise<OAuthStartResult> {
  const response = await fetch(`${window.location.origin}/api/auth/oauth-async/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ provider }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `OAuth login failed: ${response.status}`);
  }

  const data = await response.json();
  return data.payload;
}

/**
 * Poll OAuth session status
 */
export async function fetchOAuthSessionStatus(sessionId: string, token?: string): Promise<OAuthSessionStatus> {
  const response = await fetch(`${window.location.origin}/api/auth/oauth-async/${sessionId}/status`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OAuth session status: ${response.status}`);
  }

  const data = await response.json();
  return data.payload;
}

/**
 * Submit manual authorization code
 */
export async function submitOAuthCode(sessionId: string, code: string, token?: string): Promise<void> {
  const response = await fetch(`${window.location.origin}/api/auth/oauth-async/${sessionId}/code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to submit code: ${response.status}`);
  }
}

/**
 * Cancel OAuth flow
 */
export async function cancelOAuth(sessionId: string, token?: string): Promise<void> {
  const response = await fetch(`${window.location.origin}/api/auth/oauth-async/${sessionId}/cancel`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to cancel OAuth: ${response.status}`);
  }
}

/**
 * Clean up OAuth session
 */
export async function cleanupOAuthSession(sessionId: string, token?: string): Promise<void> {
  const response = await fetch(`${window.location.origin}/api/auth/oauth-async/${sessionId}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to cleanup session: ${response.status}`);
  }
}

/**
 * Revoke OAuth credentials for a provider
 */
export async function revokeOAuth(provider: string, token?: string): Promise<void> {
  const response = await fetch(`${window.location.origin}/api/auth/oauth/${provider}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to revoke OAuth: ${response.status}`);
  }
}
