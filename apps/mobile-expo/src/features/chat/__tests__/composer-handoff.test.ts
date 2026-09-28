import { beforeEach, expect, it } from 'vitest';
import { useComposerHandoff } from '../composer-handoff';
beforeEach(() => useComposerHandoff.setState({ pending: null }));
it('retains a file continuation until its gateway and conversation are focused', () => {
  const store = useComposerHandoff.getState();
  store.set({ gatewayId: 'a', conversationId: 'chat-a', text: 'About file A' });
  expect(store.consume('b', 'chat-a', false)).toBeNull();
  expect(store.consume('a', 'chat-b', false)).toBeNull();
  expect(store.consume('a', 'chat-a', false)).toEqual(expect.objectContaining({ text: 'About file A' }));
  expect(store.consume('a', 'chat-a', false)).toBeNull();
});
it('library continuations target the main conversation, never a covered detail', () => {
  const store = useComposerHandoff.getState();
  store.set({ gatewayId: 'a', conversationId: null, text: 'About a library file' });
  expect(store.consume('a', 'detail', false)).toBeNull();
  expect(store.consume('a', 'main', true)).toEqual(expect.objectContaining({ text: 'About a library file' }));
});

it('keeps attachment and auto-send intent in one atomic handoff', () => {
  const store = useComposerHandoff.getState();
  store.set({
    gatewayId: 'a', conversationId: 'chat-a', text: 'Review this', autoSend: true,
    attachments: [{ type: 'image', mimeType: 'image/png', name: 'image.png', size: 12, data: 'AA==' }],
  });
  expect(store.consume('a', 'chat-a', false)).toEqual(expect.objectContaining({
    text: 'Review this', autoSend: true,
    attachments: [expect.objectContaining({ name: 'image.png' })],
  }));
});
