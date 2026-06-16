import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

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
