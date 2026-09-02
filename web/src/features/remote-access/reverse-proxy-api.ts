import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ProbeReverseProxyResponse =
  | {
      ok: true;
      url: string;
      latencyMs: number;
      gatewayReady: boolean;
    }
  | {
      ok: false;
      code:
        | 'INVALID_JSON'
        | 'invalid_url'
        | 'invalid_scheme'
        | 'has_userinfo'
        | 'has_path'
        | 'has_query_or_fragment'
        | 'requires_https'
        | 'TIMEOUT'
        | 'TLS_INVALID'
        | 'DNS_OR_CONN_REFUSED'
        | 'NETWORK_ERROR'
        | 'AUTH_BLOCKED'
        | 'HTTP_ERROR'
        | 'NOT_XOPC_GATEWAY';
      message: string;
    };

export async function probeReverseProxyUrl(url: string): Promise<ProbeReverseProxyResponse> {
  const res = await apiFetch(apiUrl('/api/tunnel/probe-public'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  // 400 also returns a typed JSON body — let it through to the caller.
  if (!res.ok && res.status !== 400) {
    throw new Error(`Probe failed (${res.status})`);
  }
  return (await res.json()) as ProbeReverseProxyResponse;
}

/** PATCH `gateway.publicUrl` (pass null to clear). */
export async function patchReverseProxyPublicUrl(publicUrl: string | null): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      gateway: {
        publicUrl: publicUrl ?? null,
      },
    }),
  });
}
