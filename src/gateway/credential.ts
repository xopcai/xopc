export type GatewayCredential = { kind: 'token'; value: string } | { kind: 'password'; value: string };

export function createGatewayCredential(
  kind: GatewayCredential['kind'],
  value: string | undefined,
): GatewayCredential | undefined {
  const trimmed = value?.trim();
  return trimmed ? { kind, value: trimmed } : undefined;
}

export function gatewayCredentialAuthorization(credential: GatewayCredential | undefined): string | undefined {
  if (!credential || /[\r\n]/.test(credential.value)) return undefined;
  return `Bearer ${credential.value}`;
}
