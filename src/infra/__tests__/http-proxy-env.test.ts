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

describe('configured Gateway HTTP proxy', () => {
  afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); clearProxyEnv(); });
  async function setup() {
    clearProxyEnv();
    const setGlobalDispatcher = vi.fn();
    const EnvHttpProxyAgent = vi.fn(function () { return { close: vi.fn().mockResolvedValue(undefined) }; });
    const Agent = vi.fn(function () { return { close: vi.fn().mockResolvedValue(undefined) }; });
    vi.doMock('undici', () => ({ Agent, EnvHttpProxyAgent, setGlobalDispatcher }));
    return { mod: await import('../http-proxy-env.js'), setGlobalDispatcher, EnvHttpProxyAgent, Agent };
  }
  it('overrides both environment proxies for custom mode and always bypasses loopback', async () => {
    const f = await setup();
    f.mod.configureGatewayHttpProxy({ mode: 'custom', url: 'http://127.0.0.1:7897', noProxy: '.internal.test' }, { HTTP_PROXY: 'http://env.test', HTTPS_PROXY: 'http://env.test', NO_PROXY: '*' });
    expect(f.EnvHttpProxyAgent).toHaveBeenCalledWith({ httpProxy: 'http://127.0.0.1:7897', httpsProxy: 'http://127.0.0.1:7897', noProxy: 'localhost,127.0.0.1,::1,.internal.test' });
  });
  it('keeps lowercase precedence and NO_PROXY in environment mode', async () => {
    const f = await setup();
    f.mod.configureGatewayHttpProxy(undefined, { http_proxy: 'http://lower.test', HTTP_PROXY: 'http://upper.test', HTTPS_PROXY: 'https://secure.test', no_proxy: '.bypass.test' });
    expect(f.EnvHttpProxyAgent).toHaveBeenCalledWith({ httpProxy: 'http://lower.test', httpsProxy: 'https://secure.test', noProxy: 'localhost,127.0.0.1,::1,.bypass.test' });
  });
  it('uses a direct dispatcher even when startup proxy variables are set', async () => {
    const f = await setup();
    f.mod.configureGatewayHttpProxy({ mode: 'direct', url: '', noProxy: '' }, { HTTPS_PROXY: 'http://env.test' });
    expect(f.Agent).toHaveBeenCalledOnce();
    expect(f.EnvHttpProxyAgent).not.toHaveBeenCalled();
  });
  it('preserves wildcard bypass when adding mandatory loopback exclusions', async () => {
    const f = await setup();
    f.mod.configureGatewayHttpProxy(undefined, { HTTP_PROXY: 'http://env.test', NO_PROXY: '*' });
    expect(f.EnvHttpProxyAgent).toHaveBeenCalledWith({ httpProxy: 'http://env.test', httpsProxy: 'http://env.test', noProxy: '*' });
  });
});
