import { describe, it, expect } from 'vitest';

import { evaluateAccess } from '../security.js';

describe('evaluateAccess DM pairing', () => {
  const baseCtx = {
    channel: 'telegram',
    accountId: 'default',
    chatId: '1',
    senderId: '999',
    isGroup: false,
    isDm: true,
  };

  it('denies unknown sender when dmPolicy is pairing and allowFrom is empty', () => {
    const r = evaluateAccess({
      context: baseCtx,
      dmPolicy: 'pairing',
      allowFrom: [],
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('pairing-required');
  });

  it('allows sender listed in allowFrom when dmPolicy is pairing', () => {
    const r = evaluateAccess({
      context: { ...baseCtx, senderId: '42' },
      dmPolicy: 'pairing',
      allowFrom: [42],
    });
    expect(r.allowed).toBe(true);
  });

  it('wildcard * allows pairing mode', () => {
    const r = evaluateAccess({
      context: baseCtx,
      dmPolicy: 'pairing',
      allowFrom: ['*'],
    });
    expect(r.allowed).toBe(true);
  });

  it('allowlist denies with distinct reason', () => {
    const r = evaluateAccess({
      context: baseCtx,
      dmPolicy: 'allowlist',
      allowFrom: [],
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('Not in DM allowlist');
  });
});
