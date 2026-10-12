/** Local-only processing requires a loopback endpoint, regardless of provider name. */
export function isLoopbackModel(baseUrl: string): boolean {
  try { return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(baseUrl).hostname); }
  catch { return false; }
}
