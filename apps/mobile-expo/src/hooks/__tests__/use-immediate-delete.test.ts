import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImmediateDelete } from '../use-immediate-delete';

const state = vi.hoisted(() => ({ hidden: new Set<string>(), cleanup: () => {} }));
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => () => void) => { state.cleanup = effect(); },
  useRef: (current: unknown) => ({ current }),
  useState: () => [state.hidden, (update: (ids: Set<string>) => Set<string>) => { state.hidden = update(state.hidden); }],
}));
beforeEach(() => { state.hidden = new Set(); });

describe('immediate note deletion', () => {
  it('hides and starts the request immediately without waiting for a timer', async () => {
    const deletion = useImmediateDelete();
    const commit = vi.fn(async () => undefined);
    deletion.deleteImmediately('note', commit, vi.fn());
    expect(commit).toHaveBeenCalledOnce();
    expect(state.hidden.has('note')).toBe(true);
    await Promise.resolve();
    expect(state.hidden.has('note')).toBe(true);
  });
  it('suppresses duplicate requests while deleting', async () => {
    const deletion = useImmediateDelete();
    let finish!: () => void;
    const commit = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    deletion.deleteImmediately('note', commit, vi.fn());
    deletion.deleteImmediately('note', commit, vi.fn());
    expect(commit).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
  });
  it('restores only the failed item and reports failure', async () => {
    const deletion = useImmediateDelete();
    const error = new Error('Offline');
    const onError = vi.fn();
    deletion.deleteImmediately('kept-hidden', async () => {}, onError);
    deletion.deleteImmediately('failed', async () => { throw error; }, onError);
    await Promise.resolve();
    expect([...state.hidden]).toEqual(['kept-hidden']);
    expect(onError).toHaveBeenCalledWith(error);
  });
  it('finishes requests after leaving the screen without notifying the unmounted UI', async () => {
    const deletion = useImmediateDelete();
    let reject!: (error: Error) => void;
    const onError = vi.fn();
    deletion.deleteImmediately('note', () => new Promise<void>((_, fail) => { reject = fail; }), onError);
    state.cleanup();
    reject(new Error('Offline'));
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });
});
