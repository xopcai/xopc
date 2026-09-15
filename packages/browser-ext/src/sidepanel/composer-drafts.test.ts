import { describe, expect, it, vi } from 'vitest';
import { ComposerDrafts, EMPTY_DRAFT } from './composer-drafts';

describe('composer draft isolation', () => {
  it('keeps late attachments in the originating chat', () => {
    const store = new ComposerDrafts(vi.fn(), vi.fn().mockResolvedValue(undefined));
    store.update('a', draft => ({ ...draft, text: 'A' }));
    store.update('b', draft => ({ ...draft, text: 'B' }));
    store.update('a', draft => ({ ...draft, attachments: [{ type: 'file', name: 'a.txt', mimeType: 'text/plain', size: 1, data: 'YQ==' }] }));
    expect(store.get('a').attachments).toHaveLength(1);
    expect(store.get('b')).toEqual({ ...EMPTY_DRAFT, text: 'B' });
  });

  it('does not overwrite edits with late persisted state', async () => {
    let resolve!: (value: typeof EMPTY_DRAFT) => void;
    const read = () => new Promise<typeof EMPTY_DRAFT>(done => { resolve = done; });
    const store = new ComposerDrafts(vi.fn(), vi.fn().mockResolvedValue(undefined), read);
    const loading = store.load('a');
    store.update('a', draft => ({ ...draft, text: 'new' }));
    resolve({ ...EMPTY_DRAFT, text: 'old' });
    await loading;
    expect(store.get('a').text).toBe('new');
  });

  it('reports persistence failures and retains the editable draft', async () => {
    const error = vi.fn();
    const store = new ComposerDrafts(error, vi.fn().mockRejectedValue(new Error('quota')));
    store.update('a', draft => ({ ...draft, text: 'keep' }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(error).toHaveBeenCalled();
    expect(store.get('a').text).toBe('keep');
  });
});
