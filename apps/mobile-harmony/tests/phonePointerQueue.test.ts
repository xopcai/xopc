import { expect, it, vi } from 'vitest';
import { XopcPhonePointerQueue } from '../entry/src/main/ets/common/phonePointerQueue.ets';
it('coalesces high-rate touch moves behind ACK and preserves the final move and release', () => {
  const queue = new XopcPhonePointerQueue(); const send = vi.fn(); queue.onSend = send;
  queue.pointer('down', 100, 800);
  for (let i = 0; i < 400; i++) queue.pointer('move', 100, 800 - i);
  queue.pointer('up', 100, 300);
  expect(send.mock.calls).toEqual([['down', 100, 800, 1]]);
  queue.ack(1); expect(send.mock.calls[1]).toEqual(['move', 100, 300, 2]);
  queue.ack(2); expect(send.mock.calls[2]).toEqual(['up', 100, 300, 3]);
  queue.ack(3); expect(queue.pendingSince).toBe(0);
});
it('drops stale ACKs and pending gestures when ownership or geometry changes', () => {
  const queue = new XopcPhonePointerQueue(); const send = vi.fn(); const cancel = vi.fn(); queue.onSend = send; queue.onCancel = cancel;
  queue.pointer('down', 10, 10); queue.pointer('move', 20, 20); queue.cancel(); queue.ack(1);
  expect(cancel).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledOnce();
  queue.pointer('down', 30, 30); queue.pointer('up', 30, 30); queue.ack(1);
  expect(send).toHaveBeenCalledTimes(2); queue.ack(2); expect(send.mock.calls[2]).toEqual(['up', 30, 30, 3]);
});
