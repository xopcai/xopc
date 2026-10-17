import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

import type { OutboundProxyConfig } from '../config/outbound-proxy.js';
const PROXY_ENV_KEYS = [
  'http_proxy',
  'HTTP_PROXY',
  'https_proxy',
  'HTTPS_PROXY',
  'no_proxy',
  'NO_PROXY',
] as const;

type ProxyEnv = Record<string, string | undefined>;

export function hasProxyEnv(env: ProxyEnv = process.env): boolean {
  return PROXY_ENV_KEYS.some((key) => typeof env[key] === 'string' && env[key]!.trim().length > 0);
}

export function installGlobalProxyDispatcherFromEnv(env: ProxyEnv = process.env): boolean {
  if (!hasProxyEnv(env)) {
    return false;
  }

  setGlobalDispatcher(new EnvHttpProxyAgent());
  return true;
}

installGlobalProxyDispatcherFromEnv();

/** Applied once at Gateway startup; saved changes require a process restart. */
export function configureGatewayHttpProxy(config?: OutboundProxyConfig, env: ProxyEnv = process.env): void {
  if (config?.mode === 'direct') {
    setGlobalDispatcher(new Agent());
    return;
  }
  const httpProxy = config?.mode === 'custom' ? config.url : env.http_proxy ?? env.HTTP_PROXY ?? '';
  const httpsProxy = config?.mode === 'custom' ? config.url : env.https_proxy ?? env.HTTPS_PROXY ?? httpProxy;
  const bypass = [config?.mode === 'custom' ? '' : env.no_proxy ?? env.NO_PROXY ?? '', config?.noProxy ?? ''];
  const noProxy = bypass.some(value => value.split(/[,\s]+/).includes('*'))
    ? '*'
    : ['localhost', '127.0.0.1', '::1', ...bypass].filter(Boolean).join(',');
  setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy, httpsProxy, noProxy }));
}
