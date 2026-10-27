import { PassThrough } from 'node:stream';

import { expect, it, vi } from 'vitest';

import { PhoneUiSession } from '../ui-session.js';

function fixture(reply: (request: Record<string, unknown>, stream: PassThrough) => void) {
  const stream = new PassThrough();
  const write = vi.fn(async (data: Uint8Array) => reply(JSON.parse(Buffer.from(data).toString()), stream));
  const close = vi.fn(async () => { stream.destroy(); });
  return { session: new PhoneUiSession({ readable: stream, write, close }), write, close };
}
const target = { text: 'old', resourceId: 'app:id/query', bounds: [0, 0, 100, 100] as [number, number, number, number],
  description: '', focused: true, editable: true, password: false, clickable: true };

it('reuses the same observer and decodes fragmented Unicode without caching a previous snapshot', async () => {
  let count = 0;
  const { session, write, close } = fixture((request, stream) => {
    const bytes = Buffer.from(JSON.stringify({ id: request.id, ok: true, xml: `<hierarchy>咖啡${++count}</hierarchy>` }) + '\n');
    for (const byte of bytes) stream.write(Buffer.from([byte]));
  });
  expect(await session.snapshot(new AbortController().signal)).toContain('咖啡1');
  expect(await session.snapshot(new AbortController().signal)).toContain('咖啡2');
  expect(write).toHaveBeenCalledTimes(2);
  await session.close(); await session.close(); expect(close).toHaveBeenCalledOnce();
});

it('sends exact target identity and old value for one native replacement', async () => {
  const { session, write } = fixture((request, stream) => stream.write(JSON.stringify({ id: request.id, ok: true }) + '\n'));
  await session.replace('app', target, '咖啡😀', new AbortController().signal);
  expect(JSON.parse(Buffer.from(write.mock.calls[0][0]).toString())).toMatchObject({ op: 'setText', app: 'app',
    resourceId: target.resourceId, bounds: '0,0,100,100', before: 'old', text: '咖啡😀' });
  await session.close();
});

it.each(['wrong-id', 'refused', 'truncated', 'oversized'])('closes on %s and never replays an uncertain write', async kind => {
  const { session, write, close } = fixture((request, stream) => {
    if (kind === 'truncated') { stream.end('{'); return; }
    if (kind === 'oversized') { stream.end('x'.repeat(2 * 1024 * 1024 + 1)); return; }
    stream.write(JSON.stringify({ id: kind === 'wrong-id' ? 999 : request.id, ok: kind !== 'refused' }) + '\n');
  });
  await expect(session.replace('app', target, 'new', new AbortController().signal)).rejects.toMatchObject({ code: 'PHONE_TEXT_INPUT_UNCONFIRMED' });
  await expect(session.snapshot(new AbortController().signal)).rejects.toMatchObject({ code: 'PHONE_UI_UNAVAILABLE' });
  expect(write).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
});

it('closes a pending observation on cancellation and rejects concurrent requests', async () => {
  const { session, write, close } = fixture(() => {});
  const controller = new AbortController();
  const pending = session.snapshot(controller.signal);
  await expect(session.snapshot(controller.signal)).rejects.toMatchObject({ code: 'PHONE_UI_UNAVAILABLE' });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'PHONE_UI_UNAVAILABLE' });
  expect(write).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
});

it('waits for transport cleanup before settling a cancelled request', async () => {
  const stream = new PassThrough(); let finish!: () => void;
  const drained = new Promise<void>(resolve => { finish = resolve; });
  const session = new PhoneUiSession({ readable: stream, write: async () => {}, close: () => drained });
  const controller = new AbortController(); let settled = false;
  const pending = session.snapshot(controller.signal).catch(error => { settled = true; return error; });
  controller.abort(); await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
  finish(); expect(await pending).toMatchObject({ code: 'PHONE_UI_UNAVAILABLE' }); stream.destroy();
});
