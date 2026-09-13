import { establishBrowserSession } from '@/stores/gateway-store';

export type GatewayCredentialVerification =
  | { status: 'valid'; sessionKey: string }
  | { status: 'rejected' | 'unreachable' | 'failed' };

export async function verifyGatewayCredential(credential: string): Promise<GatewayCredentialVerification> {
  try {
    const response = await establishBrowserSession(credential);
    if (response.ok) {
      const body = await response.json() as { sessionKey?: string };
      return body.sessionKey ? { status: 'valid', sessionKey: body.sessionKey } : { status: 'failed' };
    }
    return { status: response.status === 401 || response.status === 403 ? 'rejected' : 'failed' };
  } catch { return { status: 'unreachable' }; }
}
