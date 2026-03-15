import { describe, it, expect, beforeEach } from 'vitest';
import { createAppStore, resetStore } from '../core/store.js';

describe('AppStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should create store with initial state', () => {
    const store = createAppStore();
    const state = store.getState();

    expect(state.route.current).toEqual({ type: 'recent' });
    expect(state.session.list).toEqual([]);
    expect(state.connection.status).toBe('disconnected');
  });

  it('should update session list', () => {
    const store = createAppStore();
    const sessions = [
      { key: 'gateway:1', name: 'Session 1', updatedAt: '2024-01-01', messageCount: 5 },
      { key: 'gateway:2', name: 'Session 2', updatedAt: '2024-01-02', messageCount: 3 },
    ];

    store.getState().setSessionList(sessions);

    expect(store.getState().session.list).toHaveLength(2);
    expect(store.getState().session.list[0].key).toBe('gateway:1');
  });

  it('should set current session', () => {
    const store = createAppStore();
    const session = { key: 'gateway:1', name: 'Test', updatedAt: '2024-01-01', messageCount: 0 };

    store.getState().setCurrentSession(session);

    expect(store.getState().session.current?.key).toBe('gateway:1');
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

    expect(store.getState().message.messages).toHaveLength(1);
    expect(store.getState().message.messages[0].content[0].text).toBe('Hello');
  });

  it('should update streaming content', () => {
    const store = createAppStore();

    store.getState().setStreamingActive(true);
    store.getState().setStreamingContent('Hello');
    store.getState().appendStreamingContent(' World');

    expect(store.getState().message.streaming.isActive).toBe(true);
    expect(store.getState().message.streaming.content).toBe('Hello World');
  });

  it('should update connection state', () => {
    const store = createAppStore();

    store.getState().setConnectionStatus('connecting');
    expect(store.getState().connection.status).toBe('connecting');

    store.getState().setConnectionStatus('connected');
    expect(store.getState().connection.status).toBe('connected');
  });

  it('should track reconnection count', () => {
    const store = createAppStore();

    store.getState().incrementReconnect();
    store.getState().incrementReconnect();

    expect(store.getState().connection.reconnectCount).toBe(2);

    store.getState().resetReconnect();
    expect(store.getState().connection.reconnectCount).toBe(0);
  });

  it('should navigate routes', () => {
    const store = createAppStore();

    store.getState().navigateRoute({ type: 'session', sessionKey: 'gateway:abc' });

    expect(store.getState().route.current.type).toBe('session');
    expect(store.getState().route.current.sessionKey).toBe('gateway:abc');
    expect(store.getState().route.previous?.type).toBe('recent');
  });
});
