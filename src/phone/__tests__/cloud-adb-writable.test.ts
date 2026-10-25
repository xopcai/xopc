import { Consumable, WritableStream } from '@yume-chan/stream-extra';
import { expect, it } from 'vitest';

import { observeAdbConsumption } from '../cloud-adb-writable.js';

it('handles consumption rejection when the producer stops at a failed write', async () => {
  const error = Object.assign(new Error('Cannot call write after a stream was destroyed'), { code: 'ERR_STREAM_DESTROYED' });
  const sink = new Consumable.WritableStream<Uint8Array>({ write() { return Promise.reject(error); } });
  const writer = observeAdbConsumption(sink).getWriter();
  await expect(Consumable.WritableStream.write(writer, new Uint8Array([1]))).rejects.toBe(error);
  await expect(writer.closed).rejects.toBe(error);
  // Allow Node to report any unobserved consumption rejection to Vitest.
  await new Promise(resolve => setImmediate(resolve));
});

it('preserves successful consumption and closes the destination', async () => {
  const chunks: Uint8Array[] = [];
  let closed = false;
  const writer = observeAdbConsumption(new Consumable.WritableStream<Uint8Array>({
    write(chunk) { chunks.push(chunk); },
    close() { closed = true; },
  })).getWriter();
  await Consumable.WritableStream.write(writer, new Uint8Array([1, 2]));
  await writer.close();
  expect(chunks).toEqual([new Uint8Array([1, 2])]);
  expect(closed).toBe(true);
});

it('forwards cancellation to the destination', async () => {
  let reason: unknown;
  const writer = observeAdbConsumption(new WritableStream<Consumable<Uint8Array>>({
    abort(error) { reason = error; },
  })).getWriter();
  await writer.abort('disconnected');
  expect(reason).toBe('disconnected');
});
