export const DEVICE_SIGNED_REQUEST_HEADERS = ['content-type', 'idempotency-key', 'x-xopc-expected-session-key', 'x-endpoint-id', 'x-endpoint-upload-token'] as const;

/** Signing serialization shared by clients and Gateway; digests/signatures stay platform-owned. */
export function deviceRequestProofMessage(input: {
  gatewayId: string; credentialDigest: string; method: string; target: string;
  headers: (name: string) => string | undefined;
  proof: { timestamp: number; nonce: string; digest: string };
}): string {
  return ['xopc-request-v1', input.gatewayId, input.credentialDigest, input.method, input.target,
    input.proof.digest, ...DEVICE_SIGNED_REQUEST_HEADERS.map(name => input.headers(name) ?? ''),
    String(input.proof.timestamp), input.proof.nonce].join('\n');
}

export function buildRefreshProofMessage(input: {
  credentialId: string; timestamp: number; nonce: string; requestId: string; nextRefreshToken: string; requestProofVersion: 1;
}): string {
  return `xopc-device-refresh-v2\n${input.credentialId}\n${input.timestamp}\n${input.nonce}\n${input.requestId}\n${input.nextRefreshToken}\nrequest-proof:${input.requestProofVersion}`;
}
