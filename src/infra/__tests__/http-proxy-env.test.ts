import { afterEach, describe, expect, it, vi } from 'vitest';

const PROXY_ENV_KEYS = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY'];

function clearProxyEnv(): void {
  for (const key of PROXY_ENV_KEYS) {
    delete process.env[key];
  }
}

describe('http proxy env bootstrap', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    clearProxyEnv();
  });

  it('does not install a dispatcher when proxy env is empty', async () => {
    clearProxyEnv();
    const setGlobalDispatcher = vi.fn();
    const EnvHttpProxyAgent = vi.fn();
    vi.doMock('undici', () => ({ EnvHttpProxyAgent, setGlobalDispatcher }));

    const mod = await import('../http-proxy-env.js');

    expect(mod.hasProxyEnv()).toBe(false);
    expect(setGlobalDispatcher).not.toHaveBeenCalled();
    expect(EnvHttpProxyAgent).not.toHaveBeenCalled();
  });

  it('installs EnvHttpProxyAgent when lowercase proxy env is set', async () => {
    clearProxyEnv();
    process.env.http_proxy = 'http://127.0.0.1:7897';
    const setGlobalDispatcher = vi.fn();
    const agent = { kind: 'env-proxy-agent' };
    const EnvHttpProxyAgent = vi.fn(function EnvHttpProxyAgent(this: unknown) {
      return agent;
    });
    vi.doMock('undici', () => ({ EnvHttpProxyAgent, setGlobalDispatcher }));

    const mod = await import('../http-proxy-env.js');

    expect(mod.hasProxyEnv()).toBe(true);
    expect(EnvHttpProxyAgent).toHaveBeenCalledTimes(1);
    expect(setGlobalDispatcher).toHaveBeenCalledWith(agent);
  });

  it('installs EnvHttpProxyAgent when uppercase proxy env is set', async () => {
    clearProxyEnv();
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7897';
    const setGlobalDispatcher = vi.fn();
    const agent = { kind: 'env-proxy-agent' };
    const EnvHttpProxyAgent = vi.fn(function EnvHttpProxyAgent(this: unknown) {
      return agent;
    });
    vi.doMock('undici', () => ({ EnvHttpProxyAgent, setGlobalDispatcher }));

    await import('../http-proxy-env.js');

    expect(EnvHttpProxyAgent).toHaveBeenCalledTimes(1);
    expect(setGlobalDispatcher).toHaveBeenCalledWith(agent);
  });
});
