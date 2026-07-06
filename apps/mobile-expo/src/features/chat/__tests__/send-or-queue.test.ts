import { describe, expect, it, vi } from 'vitest';

import { sendOrQueueMessage } from '../send-or-queue';
import { MAX_PENDING_FOLLOW_UPS } from '../pending-follow-up.types';

describe('sendOrQueueMessage', () => {
  it('sends when idle', () => {
    const send = vi.fn();
    const add = vi.fn();
    sendOrQueueMessage({
      text: '  hello  ',
      runBusy: false,
      pendingCount: 0,
      send,
      addPendingFollowUp: add,
    });
    expect(send).toHaveBeenCalledWith('hello');
    expect(add).not.toHaveBeenCalled();
  });

  it('enqueues when busy', () => {
    const send = vi.fn();
    const add = vi.fn();
    sendOrQueueMessage({
      text: 'queued',
      runBusy: true,
      pendingCount: 0,
      send,
      addPendingFollowUp: add,
    });
    expect(add).toHaveBeenCalledWith('queued');
    expect(send).not.toHaveBeenCalled();
  });

  it('calls onQueueFull when queue is full', () => {
    const onQueueFull = vi.fn();
    sendOrQueueMessage({
      text: 'x',
      runBusy: true,
      pendingCount: MAX_PENDING_FOLLOW_UPS,
      send: vi.fn(),
      addPendingFollowUp: vi.fn(),
      onQueueFull,
    });
    expect(onQueueFull).toHaveBeenCalled();
  });
});
