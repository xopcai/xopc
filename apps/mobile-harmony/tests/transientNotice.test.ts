import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { XopcTransientNotice, XOPC_TRANSIENT_NOTICE_MS } from '../entry/src/main/ets/common/transientNotice.ets';

describe('transient composer feedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('expires feedback without an interaction', () => {
    let message = '';
    const notice = new XopcTransientNotice(next => { message = next; });
    notice.show('OFFLINE');
    vi.advanceTimersByTime(XOPC_TRANSIENT_NOTICE_MS - 1);
    expect(message).toBe('OFFLINE');
    vi.advanceTimersByTime(1);
    expect(message).toBe('');
  });

  it('gives repeated failures a full lifetime and cancels old expiry callbacks', () => {
    const publish = vi.fn();
    const notice = new XopcTransientNotice(publish);
    notice.show('OFFLINE');
    vi.advanceTimersByTime(4000);
    notice.show('OFFLINE');
    publish.mockClear();
    vi.advanceTimersByTime(2000);
    expect(publish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    expect(publish).toHaveBeenCalledExactlyOnceWith('');
  });

  it('releases its timer when dismissed or its owner leaves', () => {
    const publish = vi.fn();
    const notice = new XopcTransientNotice(publish);
    notice.show('failed'); notice.clear();
    publish.mockClear();
    vi.advanceTimersByTime(XOPC_TRANSIENT_NOTICE_MS);
    expect(publish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
