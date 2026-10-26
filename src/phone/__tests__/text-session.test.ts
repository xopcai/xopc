import { expect, it, vi } from 'vitest';
import { PhoneTextSession } from '../text-session.js';

it('reuses the Unicode channel during one operation and closes it at the boundary', async () => {
  const provider = { pasteText: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const create = vi.fn(async () => provider); const session = new PhoneTextSession(create);
  await session.paste('咖啡', new AbortController().signal);
  await session.paste('地图', new AbortController().signal);
  expect(create).toHaveBeenCalledOnce(); expect(provider.pasteText).toHaveBeenCalledTimes(2);
  await session.close(); await session.close(); expect(provider.close).toHaveBeenCalledOnce();
});

it('does not retry a failed paste and preserves its uncertain outcome during cleanup failure', async () => {
  const failure = new Error('ACK lost');
  const provider = { pasteText: vi.fn(async () => { throw failure; }), close: vi.fn(async () => { throw new Error('cleanup failed'); }) };
  const create = vi.fn(async () => provider); const session = new PhoneTextSession(create);
  await expect(session.paste('咖啡', new AbortController().signal)).rejects.toBe(failure);
  expect(provider.pasteText).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
});

it('drains asynchronous failure cleanup before returning an uncertain paste outcome', async () => {
  let finishCleanup!: () => void;
  const cleanup = new Promise<void>(resolve => { finishCleanup = resolve; });
  const failure = new Error('connection lost');
  let failed!: () => void;
  const provider = { pasteText: vi.fn(async () => { failed(); throw failure; }), close: vi.fn(() => cleanup) };
  const session = new PhoneTextSession(async onFailure => { failed = onFailure; return provider; });
  let settled = false;
  const result = session.paste('咖啡', new AbortController().signal).catch(error => { settled = true; return error; });
  await vi.waitFor(() => expect(provider.close).toHaveBeenCalledOnce());
  expect(settled).toBe(false); finishCleanup(); expect(await result).toBe(failure);
  expect(provider.pasteText).toHaveBeenCalledOnce();
});
