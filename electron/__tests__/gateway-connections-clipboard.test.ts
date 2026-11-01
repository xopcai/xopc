import { expect, it, vi } from 'vitest';

import { DesktopExecutionCatalog } from '../desktop/execution-catalog.js';
import { DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR, desktopClipboardWorker } from '../desktop/clipboard-tool.js';

it('writes once through the bounded adapter and never reads the existing clipboard', async () => {
  const writeText = vi.fn(async () => {}), worker = desktopClipboardWorker({ writeText });
  await expect(worker.run({ text: 'fixture text' }, new AbortController().signal)).resolves.toMatchObject({ status: 'succeeded' });
  expect(writeText).toHaveBeenCalledExactlyOnceWith('fixture text');
  await expect(worker.run({ text: 'another' }, new AbortController().signal)).rejects.toThrow();
  expect(await worker.stop()).toEqual({ confirmed: true });
});
it('refuses cancellation, additional fields and excessive input before any effect', async () => {
  const writeText = vi.fn(async () => {}), catalog = new DesktopExecutionCatalog([DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR]);
  for (const args of [{ text: '' }, { text: 'x'.repeat(4001) }, { text: 'x', path: '/arbitrary' }]) {
    expect(() => catalog.validateArguments('desktop.clipboard.write', args)).toThrow();
    await expect(desktopClipboardWorker({ writeText }).run(args, new AbortController().signal)).rejects.toThrow();
  }
  const controller = new AbortController(); controller.abort();
  await expect(desktopClipboardWorker({ writeText }).run({ text: 'fixture' }, controller.signal)).rejects.toThrow();
  expect(writeText).not.toHaveBeenCalled();
});
it('never starts a delayed write after stop was confirmed', async () => {
  const writeText = vi.fn(async () => {}), worker = desktopClipboardWorker({ writeText });
  expect(await worker.stop()).toEqual({ confirmed: true });
  await expect(worker.run({ text: 'late fixture' }, new AbortController().signal)).rejects.toThrow(); expect(writeText).not.toHaveBeenCalled();
});
it('does not report success or confirm stop while the system write is still pending', async () => {
  const system = Promise.withResolvers<void>(), writeText = vi.fn(() => system.promise), worker = desktopClipboardWorker({ writeText });
  let completed = false, stopped = false;
  const run = worker.run({ text: 'fixture' }, new AbortController().signal).then(() => { completed = true; });
  await Promise.resolve(); expect(writeText).toHaveBeenCalledOnce();
  const stop = worker.stop().then(() => { stopped = true; });
  await Promise.resolve(); expect(completed).toBe(false); expect(stopped).toBe(false);
  system.resolve(); await Promise.all([run, stop]); expect(completed).toBe(true); expect(stopped).toBe(true);
});
it('does not report a rejected system write as a successful effect', async () => {
  const worker = desktopClipboardWorker({ writeText: async () => { throw new Error('system fixture failure'); } });
  await expect(worker.run({ text: 'fixture' }, new AbortController().signal)).rejects.toThrow('system fixture failure');
  expect(await worker.stop()).toEqual({ confirmed: true });
});
