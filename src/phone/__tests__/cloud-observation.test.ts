import { describe, expect, it, vi } from 'vitest';

import { CloudAdbConnection } from '../cloud-adb.js';
import { PHONE_UI_DEX } from '../ui-dump-binary.js';

describe('cloud non-idle hierarchy capture', () => {
  it('uploads the bundled one-shot helper, reads XML, and removes the device file', async () => {
    const connection = new CloudAdbConnection('phone.example:10001', Buffer.from('fixture'));
    const sync = { write: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
    vi.spyOn(connection, 'client').mockResolvedValue({ sync: async () => sync } as never);
    const command = vi.spyOn(connection, 'command').mockImplementation(async (_path, args) => Buffer.from(args.includes('app_process') ? '<hierarchy><node/></hierarchy>' : ''));
    try {
      expect(await connection.hierarchy(AbortSignal.timeout(10_000))).toBe('<hierarchy><node/></hierarchy>');
      expect(Buffer.from(PHONE_UI_DEX, 'base64').subarray(0, 4).toString()).toBe('dex\n');
      expect(sync.write).toHaveBeenCalledWith(expect.objectContaining({ permission: 0o600 }));
      expect(command.mock.calls[0][1]).toEqual(expect.arrayContaining(['env', 'app_process', 'ai.xopc.phone.PhoneUiDump']));
      expect(command.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['rm', '-f']));
      expect(sync.dispose).toHaveBeenCalled();
    } finally { connection.dispose(); }
  });

  it('does not turn a failed helper into an empty native hierarchy and cleans up failed uploads', async () => {
    const connection = new CloudAdbConnection('phone.example:10001', Buffer.from('fixture'));
    const sync = { write: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
    vi.spyOn(connection, 'client').mockResolvedValue({ sync: async () => sync } as never);
    const command = vi.spyOn(connection, 'command').mockResolvedValue(Buffer.from('Killed'));
    try {
      await expect(connection.hierarchy(AbortSignal.timeout(10_000))).rejects.toMatchObject({ code: 'PHONE_UI_UNAVAILABLE' });
      sync.write.mockRejectedValueOnce(new Error('upload failed'));
      await expect(connection.hierarchy(AbortSignal.timeout(10_000))).rejects.toThrow('upload failed');
      expect(sync.dispose).toHaveBeenCalledTimes(2);
      expect(command.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['rm', '-f']));
    } finally { connection.dispose(); }
  });
});
