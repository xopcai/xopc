/**
 * OAuth API client
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

export interface OAuthStartResult {
  success: boolean;
  provider: string;
  message: string;
  authUrl?: string;
  deviceCode?: string;
  verificationUri?: string;
  instructions?: string;
  expires?: number;
  usesCallbackServer?: boolean;
  manualCodeRequested?: boolean;
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
 * Start OAuth login flow for a provider
 */
export async function startOAuthLogin(provider: string, token?: string): Promise<OAuthStartResult> {
  const response = await fetch(`${window.location.origin}/api/auth/oauth/start`, {
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
