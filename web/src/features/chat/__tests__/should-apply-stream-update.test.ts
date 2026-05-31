import { describe, expect, it } from 'vitest';

import {
  isViewingSession,
  resolveViewSessionKey,
  shouldApplyStreamUpdateToView,
  shouldRestoreLiveCacheToView,
} from '@/features/chat/session/should-apply-stream-update';

describe('session view isolation helpers', () => {
  it('resolves view key from route only', () => {
    expect(resolveViewSessionKey('agent:main:web:abc')).toBe('agent:main:web:abc');
    expect(resolveViewSessionKey('new')).toBeNull();
    expect(resolveViewSessionKey(null)).toBeNull();
  });

  it('applies stream updates only when stream matches routed session', () => {
    expect(
      shouldApplyStreamUpdateToView({
        streamSessionKey: 'agent:main:web:abc',
        routeSessionKey: 'agent:main:web:abc',
      }),
    ).toBe(true);
  });

  it('blocks stream updates on /chat/new even if state still points at old session', () => {
    expect(
      shouldApplyStreamUpdateToView({
        streamSessionKey: 'agent:main:web:old',
        routeSessionKey: 'new',
      }),
    ).toBe(false);
  });

  it('blocks cross-session stream paint', () => {
    expect(
      shouldApplyStreamUpdateToView({
        streamSessionKey: 'agent:main:web:old',
        routeSessionKey: 'agent:main:web:fresh',
      }),
    ).toBe(false);
  });

  it('isViewingSession is false on /chat/new even when state lags', () => {
    expect(
      isViewingSession({
        chatId: 'agent:main:web:old',
        routeSessionKey: 'new',
      }),
    ).toBe(false);
  });

  it('isViewingSession matches only the routed session key', () => {
    expect(
      isViewingSession({
        chatId: 'agent:main:web:abc',
        routeSessionKey: 'agent:main:web:abc',
      }),
    ).toBe(true);
    expect(
      isViewingSession({
        chatId: 'agent:main:web:old',
        routeSessionKey: 'agent:main:web:fresh',
      }),
    ).toBe(false);
  });

  it('only restores live cache for the routed session', () => {
    expect(
      shouldRestoreLiveCacheToView({
        cacheSessionKey: 'agent:main:web:abc',
        routeSessionKey: 'agent:main:web:abc',
      }),
    ).toBe(true);
    expect(
      shouldRestoreLiveCacheToView({
        cacheSessionKey: 'agent:main:web:old',
        routeSessionKey: 'agent:main:web:fresh',
      }),
    ).toBe(false);
  });
});
