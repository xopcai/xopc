export type MobilePairPingResponse = {
  ok: boolean;
  service?: string;
  mobilePairing?: boolean;
  port?: number;
  bindMode?: string;
  listenHost?: string;
  pairingReady?: boolean;
  blockReason?: string | null;
  tunnelConnected?: boolean;
  connectUrls?: string[];
};

export type MobilePairValidateUrlResponse =
  | { ok: true; url: string; loopback: false; probePath: string }
  | { ok: false; code: string; message: string };

function trimGatewayRoot(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** Public pairing probe — no auth (GET /api/tunnel/pair/ping). */
export async function fetchMobilePairPing(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<MobilePairPingResponse> {
  const root = trimGatewayRoot(baseUrl);
  const res = await fetch(`${root}/api/tunnel/pair/ping`, { signal });
  if (!res.ok) {
    throw new Error(`Gateway pairing probe failed (${res.status})`);
  }
  return res.json() as Promise<MobilePairPingResponse>;
}

/** Public URL validation for manual gateway config (POST /api/tunnel/pair/validate-url). */
export async function validateMobilePairBaseUrlPublic(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<MobilePairValidateUrlResponse> {
  const root = trimGatewayRoot(baseUrl);
  const res = await fetch(`${root}/api/tunnel/pair/validate-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl: root }),
    signal,
  });
  return res.json() as Promise<MobilePairValidateUrlResponse>;
}
