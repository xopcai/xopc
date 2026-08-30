import { describe, expect, it } from 'vitest';

import {
  isTrustedShellPermissionRequest,
  requiredOsMediaAccessTypes,
  tccToTriState,
} from '../ipc/shell-permission-gates.js';

describe('tccToTriState', () => {
  it('maps granted', () => {
    expect(tccToTriState('granted')).toBe('granted');
  });

  it('maps denied and restricted', () => {
    expect(tccToTriState('denied')).toBe('denied');
    expect(tccToTriState('restricted')).toBe('denied');
  });

  it('maps not-determined and unknown to unknown', () => {
    expect(tccToTriState('not-determined')).toBe('unknown');
    expect(tccToTriState('unknown')).toBe('unknown');
  });
});

describe('requiredOsMediaAccessTypes', () => {
  it('maps generic media checks using the requested media details', () => {
    expect(requiredOsMediaAccessTypes('media', { mediaType: 'audio' })).toEqual(['microphone']);
    expect(requiredOsMediaAccessTypes('media', { mediaType: 'video' })).toEqual(['camera']);
    expect(requiredOsMediaAccessTypes('media', { mediaTypes: ['audio', 'video'] })).toEqual([
      'microphone',
      'camera',
    ]);
  });

  it('denies ambiguous generic media checks instead of treating them as microphone access', () => {
    expect(requiredOsMediaAccessTypes('media')).toEqual([]);
    expect(requiredOsMediaAccessTypes('media', { mediaType: 'unknown' })).toEqual([]);
  });
});

describe('isTrustedShellPermissionRequest', () => {
  it('accepts matching loopback gateway origins', () => {
    expect(isTrustedShellPermissionRequest([
      'http://127.0.0.1:18790/#/chat',
      'http://127.0.0.1:18790',
    ])).toBe(true);
  });

  it('rejects remote and cross-origin permission requests', () => {
    expect(isTrustedShellPermissionRequest(['https://example.com/chat'])).toBe(false);
    expect(isTrustedShellPermissionRequest([
      'http://127.0.0.1:18790/#/chat',
      'http://127.0.0.1:3000',
    ])).toBe(false);
  });
});
