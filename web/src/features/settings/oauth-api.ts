import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface OAuthStartResult {
  sessionId: string;
  provider: string;
  status: string;
}

export interface OAuthSessionStatus {
  sessionId: string;
  provider: string;
  status: 'pending' | 'waiting_auth' | 'waiting_code' | 'completed' | 'failed' | 'cancelled';
  authUrl?: string;
  instructions?: string;
  message?: string;
  error?: string;
  expiresAt: number;
}

export async function startAsyncOAuthLogin(provider: string): Promise<OAuthStartResult> {
  const res = await apiFetch(apiUrl('/api/auth/oauth-async/start'), {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `OAuth start failed: ${res.status}`);
  }
  const data = (await res.json()) as { payload: OAuthStartResult };
  return data.payload;
}

export async function fetchOAuthSessionStatus(sessionId: string): Promise<OAuthSessionStatus> {
  const res = await apiFetch(apiUrl(`/api/auth/oauth-async/${encodeURIComponent(sessionId)}/status`));
  if (!res.ok) {
    throw new Error(`OAuth status: ${res.status}`);
  }
  const data = (await res.json()) as { payload: OAuthSessionStatus };
  return data.payload;
}

export async function submitOAuthCode(sessionId: string, code: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/auth/oauth-async/${encodeURIComponent(sessionId)}/code`), {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Submit code failed: ${res.status}`);
  }
}

export async function cancelOAuth(sessionId: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/auth/oauth-async/${encodeURIComponent(sessionId)}/cancel`), {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`Cancel OAuth failed: ${res.status}`);
  }
}

export async function cleanupOAuthSession(sessionId: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/auth/oauth-async/${encodeURIComponent(sessionId)}`), {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Cleanup session failed: ${res.status}`);
  }
}

export async function revokeOAuth(provider: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/auth/oauth/${encodeURIComponent(provider)}`), {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Revoke OAuth failed: ${res.status}`);
  }
}
