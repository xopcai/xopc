import { describe, it, expect, vi } from 'vitest';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import {
  dispatchPickerKey,
  type PickerKeyAdapter,
} from '@/features/chat/composer/picker-key-adapter';

function fakeEvent(key = 'Enter'): ReactKeyboardEvent {
  return { key } as ReactKeyboardEvent;
}

function makeAdapter(
  name: string,
  active: boolean,
  consume: boolean,
): PickerKeyAdapter & { handleKey: ReturnType<typeof vi.fn> } {
  return {
    name,
    isActive: () => active,
    handleKey: vi.fn(() => consume),
  };
}

describe('dispatchPickerKey', () => {
  it('returns false and calls nothing when adapters list is empty', () => {
    expect(dispatchPickerKey([], fakeEvent())).toBe(false);
  });

  it('skips inactive adapters without calling handleKey', () => {
    const a = makeAdapter('a', false, true);
    const b = makeAdapter('b', true, true);
    const e = fakeEvent();
    expect(dispatchPickerKey([a, b], e)).toBe(true);
    expect(a.handleKey).not.toHaveBeenCalled();
    expect(b.handleKey).toHaveBeenCalledWith(e);
  });

  it('first consumer wins; later adapters are not called', () => {
    const a = makeAdapter('a', true, true);
    const b = makeAdapter('b', true, true);
    expect(dispatchPickerKey([a, b], fakeEvent())).toBe(true);
    expect(a.handleKey).toHaveBeenCalledTimes(1);
    expect(b.handleKey).not.toHaveBeenCalled();
  });

  it('falls through to next when active adapter declines', () => {
    const a = makeAdapter('a', true, false);
    const b = makeAdapter('b', true, true);
    expect(dispatchPickerKey([a, b], fakeEvent())).toBe(true);
    expect(a.handleKey).toHaveBeenCalledTimes(1);
    expect(b.handleKey).toHaveBeenCalledTimes(1);
  });

  it('returns false when no active adapter consumes', () => {
    const a = makeAdapter('a', true, false);
    const b = makeAdapter('b', false, true);
    const c = makeAdapter('c', true, false);
    expect(dispatchPickerKey([a, b, c], fakeEvent())).toBe(false);
    expect(a.handleKey).toHaveBeenCalledTimes(1);
    expect(b.handleKey).not.toHaveBeenCalled();
    expect(c.handleKey).toHaveBeenCalledTimes(1);
  });

  it('priority follows array order, not isActive truthiness', () => {
    const callOrder: string[] = [];
    const a: PickerKeyAdapter = {
      name: 'a',
      isActive: () => true,
      handleKey: () => {
        callOrder.push('a');
        return false;
      },
    };
    const b: PickerKeyAdapter = {
      name: 'b',
      isActive: () => true,
      handleKey: () => {
        callOrder.push('b');
        return true;
      },
    };
    dispatchPickerKey([a, b], fakeEvent());
    expect(callOrder).toEqual(['a', 'b']);
  });
});
