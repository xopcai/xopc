import { BROWSER_EXTENSION_PROTOCOL_VERSION } from '@xopcai/browser-control-contract';
import { describe, expect, it } from 'vitest';

import { isBrowserWireResult } from '../extension.js';

describe('browser extension protocol', () => {
  it('uses an explicit protocol version', () => {
    expect(BROWSER_EXTENSION_PROTOCOL_VERSION).toBe(2);
  });

  it('rejects responses that do not contain a v2 result envelope', () => {
    expect(isBrowserWireResult({ id: 'cmd-1', ok: true })).toBe(false);
    expect(isBrowserWireResult({ id: 'cmd-1', result: { ok: true, receipt: {} } })).toBe(true);
    expect(isBrowserWireResult({ id: 'cmd-1', result: { error: {} } })).toBe(false);
  });
});
