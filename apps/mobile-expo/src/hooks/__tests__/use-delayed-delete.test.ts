import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIST_DELETE_UNDO_MS } from '../../constants/list-interaction';
import { useDelayedDelete } from '../use-delayed-delete';

const setters = vi.hoisted(() => [] as ReturnType<typeof vi.fn>[]);
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => { effect(); },
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    let value = typeof initial === 'function' ? initial() : initial;
    const set = vi.fn((next: unknown) => { value = typeof next === 'function' ? next(value) : next; });
    setters.push(set);
    return [value, set];
  },
}));

beforeEach(() => { vi.useFakeTimers(); setters.length = 0; });
afterEach(() => vi.useRealTimers());

describe('single note deletion undo window', () => {
  it('does not send a delete request when undone during the grace period', async () => {
    const deletion = useDelayedDelete();
    const commit = vi.fn(async () => undefined);
    deletion.scheduleDelete('note', commit, vi.fn());
    await vi.advanceTimersByTimeAsync(LIST_DELETE_UNDO_MS - 1);
    deletion.undoDelete('note');
    await vi.advanceTimersByTimeAsync(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it('cannot restore a note once its delete request is in flight', async () => {
    const deletion = useDelayedDelete();
    let finish!: () => void;
    const commit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    deletion.scheduleDelete('note', commit, vi.fn());
    await vi.advanceTimersByTimeAsync(LIST_DELETE_UNDO_MS);
    expect(commit).toHaveBeenCalledTimes(1);
    const hiddenUpdates = setters[0].mock.calls.length;
    deletion.undoDelete('note');
    expect(setters[0]).toHaveBeenCalledTimes(hiddenUpdates);
    finish();
  });

  it('restores the note and reports a failed deletion', async () => {
    const deletion = useDelayedDelete();
    const error = new Error('Offline');
    const onError = vi.fn();
    deletion.scheduleDelete('note', async () => { throw error; }, onError);
    await vi.advanceTimersByTimeAsync(LIST_DELETE_UNDO_MS);
    expect(onError).toHaveBeenCalledWith(error);
    const restore = setters[0].mock.lastCall?.[0] as (ids: Set<string>) => Set<string>;
    expect(restore(new Set(['note'])).has('note')).toBe(false);
  });
});
