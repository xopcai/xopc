import { describe, expect, it } from 'vitest';

import { decideElectronNavigation } from '../navigation-policy.js';

const CURRENT = 'http://127.0.0.1:18790/#/notes/note-1';

describe('Electron navigation policy', () => {
  it('keeps supported deep links and same-origin app routes inside xopc', () => {
    expect(decideElectronNavigation(CURRENT, 'xopc://open?kind=session&id=session-1')).toEqual({
      kind: 'internal-deep-link',
      url: 'xopc://open?kind=session&id=session-1',
    });
    expect(decideElectronNavigation(CURRENT, 'http://127.0.0.1:18790/#/chat/session-1')).toEqual({
      kind: 'same-origin',
      route: '/chat/session-1',
    });
    expect(decideElectronNavigation(CURRENT, 'http://127.0.0.1:18790/api/config')).toEqual({
      kind: 'same-origin',
      route: null,
    });
  });

  it('opens all off-origin HTTP(S) targets externally, including other loopback ports', () => {
    expect(decideElectronNavigation(CURRENT, 'https://example.com/docs')).toEqual({
      kind: 'external-http',
      url: 'https://example.com/docs',
    });
    expect(decideElectronNavigation(CURRENT, 'http://127.0.0.1:9999/site/demo')).toEqual({
      kind: 'external-http',
      url: 'http://127.0.0.1:9999/site/demo',
    });
  });

  it('opens published sites externally even when served by the current gateway', () => {
    expect(decideElectronNavigation(CURRENT, 'http://127.0.0.1:18790/site/demo/')).toEqual({
      kind: 'external-http',
      url: 'http://127.0.0.1:18790/site/demo/',
    });
  });

  it('denies malformed, credentialed, unsupported, and invalid xopc targets', () => {
    for (const target of [
      'javascript:alert(1)',
      'file:///tmp/private',
      'https://user:password@example.com',
      'xopc://unknown/path',
      'xopc://open?kind=unknown&id=item-1',
      'not a url',
    ]) {
      expect(decideElectronNavigation(CURRENT, target)).toEqual({ kind: 'deny' });
    }
  });
});
