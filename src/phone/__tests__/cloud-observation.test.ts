import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { CloudAdbConnection } from '../cloud-adb.js';
import { PHONE_UI_DEX } from '../ui-dump-binary.js';

function fixture() {
  const connection = new CloudAdbConnection('phone.example:10001', Buffer.from('fixture'));
  const hash = createHash('sha256').update(Buffer.from(PHONE_UI_DEX, 'base64')).digest('hex');
  const files = new Map<string, string>();
  const sync = { write: vi.fn(async ({ filename }: { filename: string }) => { files.set(filename, hash); }), dispose: vi.fn(async () => {}) };
  vi.spyOn(connection, 'client').mockResolvedValue({ sync: async () => sync } as never);
  const command = vi.spyOn(connection, 'command').mockImplementation(async (_path, args) => {
    if (args.includes('sha256sum')) return Buffer.from(files.get(args.at(-1)!) ?? '');
    if (args.includes('mv')) files.set(args.at(-1)!, files.get(args.at(-2)!)!);
    if (args.includes('rm')) files.delete(args.at(-1)!);
    return Buffer.from(args.includes('app_process') ? '<hierarchy><node/></hierarchy>' : '');
  });
  return { connection, hash, files, sync, command, signal: AbortSignal.timeout(10000) };
}

describe('cloud non-idle hierarchy capture', () => {
  it('verifies and reuses the deployed read-only helper without repeated uploads', async () => {
    const f = fixture();
    try {
      await f.connection.hierarchy(f.signal); await f.connection.hierarchy(f.signal);
      expect(f.sync.write).toHaveBeenCalledOnce();
      expect(f.sync.write).toHaveBeenCalledWith(expect.objectContaining({ permission: 0o600 }));
      expect(f.command.mock.calls.filter(call => call[1].includes('chmod'))[0][1]).toContain('400');
      expect(f.command.mock.calls.filter(call => call[1].includes('app_process'))).toHaveLength(2);
      expect([...f.files.keys()]).toEqual([`/data/local/tmp/xopc-ui-${f.hash}.dex`]);
      f.files.set(`/data/local/tmp/xopc-ui-${f.hash}.dex`, 'corrupted');
      await f.connection.hierarchy(f.signal);
      expect(f.sync.write).toHaveBeenCalledTimes(2);
      f.files.clear(); await f.connection.hierarchy(f.signal);
      expect(f.sync.write).toHaveBeenCalledTimes(3);
    } finally { f.connection.dispose(); }
  });

  it('does not launch an unverified upload and cleans temporary files on failure', async () => {
    const f = fixture(); f.sync.write.mockImplementation(async ({ filename }) => { f.files.set(filename, 'corrupted'); });
    try {
      await expect(f.connection.hierarchy(f.signal)).rejects.toMatchObject({ code: 'PHONE_UI_UNAVAILABLE' });
      expect(f.command.mock.calls.some(call => call[1].includes('app_process'))).toBe(false);
      expect([...f.files.keys()].some(path => path.endsWith('.tmp'))).toBe(false);
      f.sync.write.mockRejectedValueOnce(new Error('upload failed'));
      await expect(f.connection.hierarchy(f.signal)).rejects.toThrow('upload failed');
      expect(f.sync.dispose).toHaveBeenCalledTimes(2);
    } finally { f.connection.dispose(); }
  });

  it('fails closed when the deployed helper cannot read the UI', async () => {
    const f = fixture(); f.files.set(`/data/local/tmp/xopc-ui-${f.hash}.dex`, f.hash);
    f.command.mockImplementation(async (_path, args) => Buffer.from(args.includes('sha256sum') ? f.hash : 'Killed'));
    try {
      await expect(f.connection.hierarchy(f.signal)).rejects.toMatchObject({ code: 'PHONE_UI_UNAVAILABLE' });
      expect(f.sync.write).not.toHaveBeenCalled();
    } finally { f.connection.dispose(); }
  });
});

it('multiplexes resident snapshot requests over one verified cloud exec socket', async () => {
  const { PassThrough } = await import('node:stream');
  const f = fixture(); const stream = new PassThrough();
  const write = vi.fn(async (bytes: Uint8Array) => {
    const request = JSON.parse(Buffer.from(bytes).toString());
    stream.write(JSON.stringify({ id: request.id, ok: true, xml: '<hierarchy></hierarchy>' }) + '\n');
  });
  const close = vi.fn(async () => { stream.destroy(); });
  const releaseLock = vi.fn();
  const createSocket = vi.fn(async () => ({ readable: stream, writable: { getWriter: () => ({ write, closed: new Promise(() => {}), releaseLock }) }, close }));
  vi.mocked(f.connection.client).mockResolvedValue({ sync: async () => f.sync, createSocket } as never);
  try {
    const session = await f.connection.observer(f.signal);
    await session.snapshot(f.signal); await session.snapshot(f.signal);
    expect(createSocket).toHaveBeenCalledOnce(); expect(createSocket).toHaveBeenCalledWith(expect.stringContaining('PhoneUiDump --resident'));
    expect(write).toHaveBeenCalledTimes(2); expect(f.sync.write).toHaveBeenCalledOnce();
    await session.close(); expect(close).toHaveBeenCalledOnce(); expect(releaseLock).toHaveBeenCalledOnce();
  } finally { f.connection.dispose(); }
});
