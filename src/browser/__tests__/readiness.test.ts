import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import { buildBrowserSetupDeepLink, checkBrowserReadiness } from '../readiness.js';

vi.mock('../providers/playwright-doctor.js', () => ({ playwrightChromiumDoctor: vi.fn() }));
vi.mock('../providers/browser-ext-install.js', () => ({ browserExtDoctor: vi.fn() }));

import { browserExtDoctor } from '../providers/browser-ext-install.js';
import { playwrightChromiumDoctor } from '../providers/playwright-doctor.js';

const playwrightDoctor = vi.mocked(playwrightChromiumDoctor);
const extensionDoctor = vi.mocked(browserExtDoctor);

function cfg(driver: Config['browser']['driver']): Config {
  return { browser: { enabled: true, driver } } as Config;
}

describe('browser readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSER_USE_API_KEY;
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(['extension', 'playwright', 'cdp', 'remote'] as const)('links directly to the %s driver', (driver) => {
    expect(buildBrowserSetupDeepLink(driver)).toBe(`/settings/agent-browser?driver=${driver}`);
  });

  it('reports a missing Playwright Chromium', async () => {
    playwrightDoctor.mockResolvedValue({ installed: false, reason: 'missing' });
    const error = await checkBrowserReadiness(cfg({ kind: 'playwright', headless: true }));
    expect(error?.hint).toMatchObject({ driver: 'playwright', reason: 'chromium_missing' });
  });

  it('accepts installed extension artifacts', async () => {
    extensionDoctor.mockResolvedValue({ installed: true } as never);
    expect(await checkBrowserReadiness(cfg({ kind: 'extension' }))).toBeNull();
  });

  it('reports unreachable CDP endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const error = await checkBrowserReadiness(cfg({ kind: 'cdp', endpoint: 'ws://127.0.0.1:9222/devtools/browser/x' }));
    expect(error?.hint).toMatchObject({ driver: 'cdp', reason: 'cdp_unreachable' });
  });

  it('requires remote provider credentials', async () => {
    const error = await checkBrowserReadiness(cfg({ kind: 'remote', provider: 'browserbase' }));
    expect(error?.hint).toMatchObject({ driver: 'remote', reason: 'remote_api_key_missing' });
  });
});
