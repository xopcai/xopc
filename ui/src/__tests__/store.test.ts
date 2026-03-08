import { describe, it, expect, beforeEach } from 'vitest';
import { createAppStore, resetStore } from '../core/store.js';

describe('AppStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should create store with initial state', () => {
    const store = createAppStore();
    const state = store.getState();

    expect(state.current).toBeNull();
    expect(state.list).toEqual([]);
    expect(state.state).toBe('disconnected');
    expect(state.current.type).toBe('recent');
  });

  it('should update session list', () => {
    const store = createAppStore();
    const sessions = [
      { key: 'gateway:1', name: 'Session 1', updatedAt: '2024-01-01', messageCount: 5 },
      { key: 'gateway:2', name: 'Session 2', updatedAt: '2024-01-02', messageCount: 3 },
    ];

    store.getState().setList(sessions);

    expect(store.getState().list).toHaveLength(2);
    expect(store.getState().list[0].key).toBe('gateway:1');
  });

  it('should set current session', () => {
    const store = createAppStore();
    const session = { key: 'gateway:1', name: 'Test', updatedAt: '2024-01-01', messageCount: 0 };

    store.getState().setCurrent(session);

    expect(store.getState().current?.key).toBe('gateway:1');
  });

  it('should add message', () => {
    const store = createAppStore();
    const message = {
      id: 'msg-1',
      role: 'user' as const,
      content: [{ type: 'text', text: 'Hello' }],
      timestamp: Date.now(),
    };

    store.getState().addMessage(message);

    expect(store.getState().list).toHaveLength(1);
    expect(store.getState().list[0].content[0].text).toBe('Hello');
  });

  it('should update streaming content', () => {
    const store = createAppStore();

    store.getState().setStreaming(true);
    store.getState().setStreamingContent('Hello');
    store.getState().appendStreamingContent(' World');

    expect(store.getState().streaming.isActive).toBe(true);
    expect(store.getState().streaming.content).toBe('Hello World');
  });

  it('should update connection state', () => {
    const store = createAppStore();

    store.getState().setState('connecting');
    expect(store.getState().state).toBe('connecting');

    store.getState().setState('connected');
    expect(store.getState().state).toBe('connected');
  });

  it('should track reconnection count', () => {
    const store = createAppStore();

    store.getState().incrementReconnect();
    store.getState().incrementReconnect();

    expect(store.getState().reconnectCount).toBe(2);

    store.getState().resetReconnect();
    expect(store.getState().reconnectCount).toBe(0);
  });

  it('should navigate routes', () => {
    const store = createAppStore();

    store.getState().navigate({ type: 'session', sessionKey: 'gateway:abc' });

    expect(store.getState().current.type).toBe('session');
    expect(store.getState().current.sessionKey).toBe('gateway:abc');
    expect(store.getState().previous?.type).toBe('recent');
  });
});
