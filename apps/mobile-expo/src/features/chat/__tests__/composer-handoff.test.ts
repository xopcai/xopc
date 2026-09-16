import { beforeEach, expect, it } from 'vitest';
import { useComposerHandoff } from '../composer-handoff';
beforeEach(() => useComposerHandoff.setState({ pending: null }));
it('retains a file continuation until its gateway and conversation are focused', () => {
  const store = useComposerHandoff.getState();
  store.set({ gatewayId: 'a', conversationId: 'chat-a', text: 'About file A' });
  expect(store.consume('b', 'chat-a', false)).toBeNull();
  expect(store.consume('a', 'chat-b', false)).toBeNull();
  expect(store.consume('a', 'chat-a', false)).toBe('About file A');
  expect(store.consume('a', 'chat-a', false)).toBeNull();
});
it('library continuations target the main conversation, never a covered detail', () => {
  const store = useComposerHandoff.getState();
  store.set({ gatewayId: 'a', conversationId: null, text: 'About a library file' });
  expect(store.consume('a', 'detail', false)).toBeNull();
  expect(store.consume('a', 'main', true)).toBe('About a library file');
});
