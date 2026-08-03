export function normalizeExternalHttpUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string') throw new Error('Invalid URL');
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only public HTTP(S) URLs are allowed');
  }
  return url.toString();
}
