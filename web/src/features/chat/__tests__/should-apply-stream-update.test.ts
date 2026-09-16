import { describe, expect, it } from 'vitest';

import {
  isViewingSession,
  resolveViewConversationId,
  shouldApplyStreamUpdateToView,
  shouldRestoreLiveCacheToView,
} from '@/features/chat/session/should-apply-stream-update';

describe('session view isolation helpers', () => {
  it('resolves view key from route only', () => {
    expect(resolveViewConversationId('agent:main:web:abc')).toBe('agent:main:web:abc');
    expect(resolveViewConversationId('new')).toBeNull();
    expect(resolveViewConversationId(null)).toBeNull();
  });

  it('applies stream updates only when stream matches routed session', () => {
    expect(
      shouldApplyStreamUpdateToView({
        streamConversationId: 'agent:main:web:abc',
        routeConversationId: 'agent:main:web:abc',
      }),
    ).toBe(true);
  });

  it('blocks stream updates on /chat/new even if state still points at old session', () => {
    expect(
      shouldApplyStreamUpdateToView({
        streamConversationId: 'agent:main:web:old',
        routeConversationId: 'new',
      }),
    ).toBe(false);
  });

  it('blocks cross-session stream paint', () => {
    expect(
      shouldApplyStreamUpdateToView({
        streamConversationId: 'agent:main:web:old',
        routeConversationId: 'agent:main:web:fresh',
      }),
    ).toBe(false);
  });

  it('isViewingSession is false on /chat/new even when state lags', () => {
    expect(
      isViewingSession({
        chatId: 'agent:main:web:old',
        routeConversationId: 'new',
      }),
    ).toBe(false);
  });

  it('isViewingSession matches only the routed session key', () => {
    expect(
      isViewingSession({
        chatId: 'agent:main:web:abc',
        routeConversationId: 'agent:main:web:abc',
      }),
    ).toBe(true);
    expect(
      isViewingSession({
        chatId: 'agent:main:web:old',
        routeConversationId: 'agent:main:web:fresh',
      }),
    ).toBe(false);
  });

  it('only restores live cache for the routed session', () => {
    expect(
      shouldRestoreLiveCacheToView({
        cacheConversationId: 'agent:main:web:abc',
        routeConversationId: 'agent:main:web:abc',
      }),
    ).toBe(true);
    expect(
      shouldRestoreLiveCacheToView({
        cacheConversationId: 'agent:main:web:old',
        routeConversationId: 'agent:main:web:fresh',
      }),
    ).toBe(false);
  });
});
