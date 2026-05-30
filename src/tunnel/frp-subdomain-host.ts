/** Broker subdomain host derived from broker URL. */
export function resolveFrpSubdomainHost(brokerUrl: string, override?: string): string {
  if (override?.trim()) return override.trim();
  try {
    const host = new URL(brokerUrl.replace(/\/api\/?$/, '')).hostname;
    if (host === 'frp.xopc.ai' || host.endsWith('.frp.xopc.ai')) return 'frp.xopc.ai';
    if (host.includes('.')) return host;
  } catch {
    /* fall through */
  }
  return 'frp.xopc.ai';
}
