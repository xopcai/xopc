import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  BrowserNotReadyError,
  buildBrowserSetupDeepLink,
  checkBrowserReadiness,
} from '../readiness.js';

// Mock both doctor providers so the tests don't touch disk or spawn anything.
vi.mock('../providers/playwright-doctor.js', () => ({
  playwrightChromiumDoctor: vi.fn(),
}));
vi.mock('../providers/cloakbrowser.js', () => ({
  cloakBrowserDoctor: vi.fn(),
}));
vi.mock('../providers/browser-ext-install.js', () => ({
  browserExtDoctor: vi.fn(),
}));
vi.mock('../providers/extension-ws-acquire.js', () => ({
  getExtensionBrowserServerSnapshot: vi.fn(),
}));

import { playwrightChromiumDoctor } from '../providers/playwright-doctor.js';
import { cloakBrowserDoctor } from '../providers/cloakbrowser.js';
import { browserExtDoctor } from '../providers/browser-ext-install.js';
import { getExtensionBrowserServerSnapshot } from '../providers/extension-ws-acquire.js';

const pwDoctor = playwrightChromiumDoctor as unknown as ReturnType<typeof vi.fn>;
const cbDoctor = cloakBrowserDoctor as unknown as ReturnType<typeof vi.fn>;
const extDoctor = browserExtDoctor as unknown as ReturnType<typeof vi.fn>;
const extSnap = getExtensionBrowserServerSnapshot as unknown as ReturnType<typeof vi.fn>;

function cfg(browser: Record<string, unknown>): Config {
  return { browser } as unknown as Config;
}

describe('buildBrowserSetupDeepLink', () => {
  it.each([
    ['extension', '/settings/agent-browser?tab=extension'],
    ['local', '/settings/agent-browser?tab=local'],
    ['cloakbrowser', '/settings/agent-browser?tab=cloakbrowser'],
    ['cdp', '/settings/agent-browser?tab=cdp'],
    ['cloud', '/settings/agent-browser?tab=cloud'],
  ] as const)('maps %s → %s', (backend, expected) => {
    expect(buildBrowserSetupDeepLink(backend)).toBe(expected);
  });
});

describe('checkBrowserReadiness', () => {
  const prevBrowserbaseKey = process.env.BROWSERBASE_API_KEY;
  const prevBrowserUseKey = process.env.BROWSER_USE_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSER_USE_API_KEY;
  });

  afterEach(() => {
    if (prevBrowserbaseKey === undefined) delete process.env.BROWSERBASE_API_KEY;
    else process.env.BROWSERBASE_API_KEY = prevBrowserbaseKey;
    if (prevBrowserUseKey === undefined) delete process.env.BROWSER_USE_API_KEY;
    else process.env.BROWSER_USE_API_KEY = prevBrowserUseKey;
    vi.unstubAllGlobals();
  });

  it('local: returns local_chromium_missing when Playwright Chromium is absent', async () => {
    pwDoctor.mockResolvedValue({ installed: false, reason: 'Chromium executable not found on disk' });
    const err = await checkBrowserReadiness(cfg({ backend: 'local' }));
    expect(err).toBeInstanceOf(BrowserNotReadyError);
    expect(err?.hint.backend).toBe('local');
    expect(err?.hint.reason).toBe('local_chromium_missing');
    expect(err?.hint.deepLink).toBe('/settings/agent-browser?tab=local');
  });

  it('local: null when Chromium is installed', async () => {
    pwDoctor.mockResolvedValue({ installed: true, executablePath: '/tmp/chromium' });
    expect(await checkBrowserReadiness(cfg({ backend: 'local' }))).toBeNull();
  });

  it('cloakbrowser: returns cloakbrowser_not_installed', async () => {
    cbDoctor.mockResolvedValue({ installed: false, cacheDir: '/tmp/cb' });
    const err = await checkBrowserReadiness(cfg({ backend: 'cloakbrowser' }));
    expect(err?.hint.reason).toBe('cloakbrowser_not_installed');
    expect(err?.hint.deepLink).toBe('/settings/agent-browser?tab=cloakbrowser');
  });

  it('extension: returns extension_not_installed when artifacts missing', async () => {
    extDoctor.mockResolvedValue({ installed: false });
    extSnap.mockReturnValue({ active: false, refCount: 0, key: null });
    const err = await checkBrowserReadiness(cfg({ backend: 'extension' }));
    expect(err?.hint.reason).toBe('extension_not_installed');
  });

  it('extension: returns extension_bridge_offline when WS not running', async () => {
    extDoctor.mockResolvedValue({ installed: true });
    extSnap.mockReturnValue({ active: false, refCount: 0, key: null });
    const err = await checkBrowserReadiness(cfg({ backend: 'extension' }));
    expect(err?.hint.reason).toBe('extension_bridge_offline');
  });

  it('extension: returns extension_not_connected when bridge up but no client', async () => {
    extDoctor.mockResolvedValue({ installed: true });
    extSnap.mockReturnValue({ active: true, refCount: 1, key: '127.0.0.1:19820' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, connected: false }), { status: 200 })),
    );
    const err = await checkBrowserReadiness(cfg({ backend: 'extension' }));
    expect(err?.hint.reason).toBe('extension_not_connected');
  });

  it('extension: null when bridge up and client connected', async () => {
    extDoctor.mockResolvedValue({ installed: true });
    extSnap.mockReturnValue({ active: true, refCount: 1, key: '127.0.0.1:19820' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, connected: true }), { status: 200 })),
    );
    expect(await checkBrowserReadiness(cfg({ backend: 'extension' }))).toBeNull();
  });

  it('cdp: returns cdp_unreachable on probe failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const err = await checkBrowserReadiness(
      cfg({ backend: 'cdp', cdpUrl: 'ws://127.0.0.1:65000/devtools/browser/x' }),
    );
    expect(err?.hint.backend).toBe('cdp');
    expect(err?.hint.reason).toBe('cdp_unreachable');
  });

  it('cdp: null on healthy /json/version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    expect(
      await checkBrowserReadiness(cfg({ backend: 'cdp', cdpUrl: 'ws://127.0.0.1:9222/devtools/browser/x' })),
    ).toBeNull();
  });

  it('cloud: returns cloud_api_key_missing when neither config nor env has a key', async () => {
    const err = await checkBrowserReadiness(cfg({ backend: 'cloud', cloudProvider: 'browserbase' }));
    expect(err?.hint.backend).toBe('cloud');
    expect(err?.hint.reason).toBe('cloud_api_key_missing');
  });

  it('cloud: null when config supplies a key', async () => {
    expect(
      await checkBrowserReadiness(
        cfg({ backend: 'cloud', cloudProvider: 'browserbase', cloud: { apiKey: 'sk-test' } }),
      ),
    ).toBeNull();
  });

  it('cloud: null when env supplies a key for browser-use', async () => {
    process.env.BROWSER_USE_API_KEY = 'env-test';
    expect(await checkBrowserReadiness(cfg({ backend: 'cloud', cloudProvider: 'browser-use' }))).toBeNull();
  });
});
