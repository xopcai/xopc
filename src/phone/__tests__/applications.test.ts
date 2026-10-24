import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../scrcpy-assets.js', () => ({ readScrcpyServer: vi.fn(async () => Buffer.from('pinned-server')), scrcpyServerPath: () => '/managed/server.jar' }));
import { AdbPhoneDriver } from '../adb-driver.js';
import { CloudAdbConnection } from '../cloud-adb.js';
import { parsePhoneApplications } from '../applications.js';
import { normalizePhoneAppAccess, phoneAllowsApp } from '../app-access.js';
import { parseAutoGlmResponse } from '../model-adapter.js';

const raw = '[server] INFO: List of apps:\n * 设置                          com.android.settings\n - A very long application label that wraps\n                                  app.example.reader\n - Clock                         com.android.deskclock\n';
afterEach(() => vi.restoreAllMocks());
it('reads native app names, wrapped labels and duplicate entries while rejecting invalid output', () => {
  const applications = parsePhoneApplications(raw + ' - Duplicate com.android.deskclock\n');
  expect(applications).toContainEqual({ packageName: 'com.android.settings', label: '设置' });
  expect(applications).toContainEqual({ packageName: 'app.example.reader', label: 'A very long application label that wraps' });
  expect(applications).toHaveLength(3);
  expect(() => parsePhoneApplications('server failed')).toThrow('Unable to read');
});
it('defaults new devices to all apps, preserves legacy selections and never treats an empty selected list as all', () => {
  expect(normalizePhoneAppAccess({ allowedApps: [] })).toMatchObject({ appAccess: 'all' });
  const legacy = normalizePhoneAppAccess({ allowedApps: ['com.android.settings'] });
  expect(legacy.appAccess).toBe('selected'); expect(phoneAllowsApp(legacy, 'com.android.deskclock')).toBe(false);
  expect(phoneAllowsApp({ appAccess: 'all', allowedApps: [] }, 'com.android.deskclock')).toBe(true);
  expect(() => normalizePhoneAppAccess({ appAccess: 'selected', allowedApps: [] })).toThrow('Select at least one');
});
it('resolves model app names using the installed catalog and checks the app policy', () => {
  const options = { appAccess: 'all' as const, applications: [{ packageName: 'com.android.deskclock', label: '时钟' }] };
  expect(parseAutoGlmResponse('do(action="Launch", app="时钟")', [], options)).toMatchObject({ action: { package: 'com.android.deskclock' } });
  expect(() => parseAutoGlmResponse('do(action="Launch", app="时钟")', ['com.android.settings'], { ...options, appAccess: 'selected' })).toThrow('allowlist');
  expect(() => parseAutoGlmResponse('do(action="Launch", app="invalid; shell")', [], options)).toThrow();
  expect(() => parseAutoGlmResponse('do(action="Launch", app="com.android.deskclock")', [])).toThrow();
});
it('lists local apps using the pinned server without starting video or injecting input and cleans up on failure', async () => {
  const command = vi.fn(async (_path: string, args: string[]) => args.includes('app_process') ? Buffer.from(raw) : Buffer.alloc(0));
  const driver = new AdbPhoneDriver('adb', command);
  expect(await driver.applications('serial', new AbortController().signal)).toHaveLength(3);
  expect(command.mock.calls.some(([, args]) => args.includes('list_apps=true') && args.includes('control=false'))).toBe(true);
  expect(command.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['rm', '-f']));
  command.mockImplementationOnce(async () => { throw new Error('upload failed'); });
  await expect(driver.applications('serial', new AbortController().signal)).rejects.toThrow('upload failed');
  expect(command.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['rm', '-f']));
});
it('uses authenticated cloud sync for app listing and always attempts temporary-file cleanup', async () => {
  const connection = new CloudAdbConnection('cloud.example:10001', Buffer.from('fixture'));
  const sync = { write: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
  vi.spyOn(connection, 'client').mockResolvedValue({ sync: async () => sync } as never);
  const command = vi.spyOn(connection, 'command').mockImplementation(async (_path, args) => args.includes('app_process') ? Buffer.from(raw) : Buffer.alloc(0));
  try {
    expect(await connection.applications(new AbortController().signal)).toHaveLength(3);
    expect(sync.write).toHaveBeenCalledWith(expect.objectContaining({ permission: 0o600 }));
    expect(command.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['rm', '-f']));
    sync.write.mockRejectedValueOnce(new Error('sync failed'));
    await expect(connection.applications(new AbortController().signal)).rejects.toThrow('sync failed');
    expect(command.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['rm', '-f']));
  } finally { connection.dispose(); }
});
