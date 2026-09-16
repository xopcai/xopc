import { establishBrowserSession } from '@/stores/gateway-store';

export type GatewayCredentialVerification =
  | { status: 'valid'; conversationId: string }
  | { status: 'rejected' | 'unreachable' | 'failed' };

export async function verifyGatewayCredential(credential: string): Promise<GatewayCredentialVerification> {
  try {
    const response = await establishBrowserSession(credential);
    if (response.ok) {
      const body = await response.json() as { conversationId?: string };
      return body.conversationId ? { status: 'valid', conversationId: body.conversationId } : { status: 'failed' };
    }
    return { status: response.status === 401 || response.status === 403 ? 'rejected' : 'failed' };
  } catch { return { status: 'unreachable' }; }
}
