export type MediaUri = `media://${string}`;

export function isMediaUri(value: string | undefined): value is MediaUri {
  return typeof value === 'string' && /^media:\/\/\S+/i.test(value.trim());
}

export function buildGatewayMediaReadPath(uri: string, conversationId?: string | null): string {
  const params = new URLSearchParams({ uri: uri.trim() });
  const sk = conversationId?.trim();
  if (sk) params.set('conversationId', sk);
  return `/api/media/read?${params.toString()}`;
}
