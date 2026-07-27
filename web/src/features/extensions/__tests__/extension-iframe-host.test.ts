// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { buildExtensionAssetUrl } from '../extension-asset-url';

describe('buildExtensionAssetUrl', () => {
  it('never exposes gateway credentials in the iframe URL', () => {
    const url = new URL(buildExtensionAssetUrl('local:focus board', 'ui/index.html'));

    expect(url.pathname).toBe('/api/extensions/local%3Afocus%20board/assets/ui/index.html');
    expect(url.search).toBe('');
  });
});
