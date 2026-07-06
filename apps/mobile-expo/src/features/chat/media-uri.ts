export type MediaUri = `media://${string}`;

export function isMediaUri(value: string | undefined): value is MediaUri {
  return typeof value === 'string' && /^media:\/\/\S+/i.test(value.trim());
}

export function buildGatewayMediaReadPath(uri: string, sessionKey?: string | null): string {
  const params = new URLSearchParams({ uri: uri.trim() });
  const sk = sessionKey?.trim();
  if (sk) params.set('sessionKey', sk);
  return `/api/media/read?${params.toString()}`;
}
