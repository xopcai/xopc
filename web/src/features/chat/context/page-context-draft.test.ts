import { describe, expect, it } from 'vitest';

import { createPageContextDraftStore, pageContextDraftKey } from './page-context-draft';

const source = () => ({ title: 'Note', text: 'Saved content', resourceRefs: [{ kind: 'note' as const, id: 'note', revision: '2' }],
  selection: { text: 'Unsaved content', draft: true } });

describe('page context drafts', () => {
  it('copies a captured selection and keeps tabs independent', () => {
    const first = createPageContextDraftStore();
    const second = createPageContextDraftStore();
    const input = source();
    const captured = first.capture(input);
    input.selection.text = 'Later selection';
    input.resourceRefs[0].revision = '3';
    expect(captured.envelope.selection?.text).toBe('Unsaved content');
    expect(captured.envelope.resourceRefs[0].revision).toBe('2');
    expect(first.capture(source()).envelope.sequence).toBe(2);
    expect(second.capture(source()).envelope.tabId).not.toBe(captured.envelope.tabId);
    first.put('conversation', captured);
    expect(second.store.getState().drafts).toEqual({});
  });

  it('scopes drafts to the gateway, authenticated session and conversation', () => {
    expect(new Set([
      pageContextDraftKey('one', 'auth', 'chat'), pageContextDraftKey('two', 'auth', 'chat'),
      pageContextDraftKey('one', 'different', 'chat'), pageContextDraftKey('one', 'auth', 'other'),
    ]).size).toBe(4);
  });

  it('does not overwrite an existing draft or remove a later draft on late acceptance', () => {
    const state = createPageContextDraftStore();
    const captured = state.capture(source());
    expect(state.put('chat', captured)).toBe(true);
    expect(state.put('chat', captured)).toBe(false);
    const first = state.store.getState().drafts.chat;
    state.remove('chat', first);
    expect(state.store.getState().drafts.chat).toBeUndefined();
    expect(state.put('chat', state.capture(source()))).toBe(true);
    state.remove('chat', first);
    expect(state.store.getState().drafts.chat).toBeDefined();
  });

  it('bounds retained drafts and rejects over-budget selections without truncating them', () => {
    const state = createPageContextDraftStore();
    const captured = state.capture({ ...source(), text: 'x'.repeat(17000) });
    expect(captured.preview).toHaveLength(16000);
    expect(captured.truncated).toBe(true);
    expect(() => state.capture({ ...source(), selection: { text: 'x'.repeat(16001), draft: true } })).toThrow();
    for (let index = 0; index < 20; index++) expect(state.put(String(index), captured)).toBe(true);
    expect(state.put('overflow', captured)).toBe(false);
    expect(Object.keys(state.store.getState().drafts)).toHaveLength(20);
  });
});
