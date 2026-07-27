import { apiUrl } from '@/lib/url';

export type GatewayCredentialVerification = 'valid' | 'rejected' | 'unreachable' | 'failed';

/** Verify a candidate before storing it so invalid credentials do not briefly enter app state. */
export async function verifyGatewayCredential(
  credential: string,
): Promise<GatewayCredentialVerification> {
  try {
    const response = await fetch(apiUrl('/api/config'), {
      headers: { Authorization: `Bearer ${credential}` },
    });
    if (response.ok) return 'valid';
    if (response.status === 401 || response.status === 403) return 'rejected';
    return 'failed';
  } catch {
    return 'unreachable';
  }
}
