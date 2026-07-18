import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { APP_CHROME_DRAG_CLASS } from './app-chrome';
import { GatewayConnectLanding } from './gateway-connect-landing';

// Force English locale so assertions are locale-independent.
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return {
    ...actual,
    getLanguage: (): 'en' | 'zh' => 'en',
  };
});

describe('GatewayConnectLanding', () => {
  it('provides an Electron drag region while a gateway token is required', () => {
    const html = renderToStaticMarkup(<GatewayConnectLanding />);

    expect(html).toContain(APP_CHROME_DRAG_CLASS);
  });

  it('puts the token form before optional acquisition help', () => {
    const html = renderToStaticMarkup(<GatewayConnectLanding />);

    expect(html.indexOf('<form')).toBeLessThan(html.indexOf('<details'));
    expect(html).toContain('Where do I find my token?');
  });

  it('exposes the token field as the page primary form control', () => {
    const html = renderToStaticMarkup(<GatewayConnectLanding />);

    expect(html).toContain('id="gateway-token"');
    expect(html).toContain('name="gateway-token"');
    expect(html).not.toContain('Gateway URL</span><input');
  });
});
