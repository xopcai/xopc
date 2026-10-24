import { expect, it, vi } from 'vitest';

import { AdbPhoneDriver } from '../../adb-driver.js';
import { PhoneInputSchema, type PhoneObservation } from '../../contracts.js';

it('only permits the fixed About entry for Settings control, without arbitrary intents', async () => {
  expect(() => PhoneInputSchema.parse({ op: 'open', mode: 'observe', appPackage: 'com.android.settings', settingsPage: 'about-phone' })).toThrow();
  expect(() => PhoneInputSchema.parse({ op: 'open', mode: 'control', appPackage: 'com.other.app', settingsPage: 'about-phone' })).toThrow();
  expect(() => PhoneInputSchema.parse({ op: 'open', mode: 'control', appPackage: 'com.android.settings', settingsPage: 'arbitrary-intent' })).toThrow();
  const command = vi.fn(async (_path: string, _args: string[], _signal: AbortSignal) => Buffer.from('Starting: Intent'));
  const driver = new AdbPhoneDriver('test-adb', command, false);
  const screen = { width: 1080, height: 2400, elements: [] } as unknown as PhoneObservation;
  await driver.execute('test-device', { type: 'launch', package: 'com.android.settings' }, screen, new AbortController().signal, { settleMs: 0, settingsPage: 'about-phone' });
  expect(command.mock.calls[0]?.[1]).toEqual(['-s', 'test-device', 'shell', 'am', 'start', '-a', 'android.settings.DEVICE_INFO_SETTINGS', '-p', 'com.android.settings']);
  command.mockClear();
  await expect(driver.execute('test-device', { type: 'launch', package: 'com.other.app' }, screen, new AbortController().signal, { settleMs: 0, settingsPage: 'about-phone' })).rejects.toMatchObject({ code: 'PHONE_APP_DENIED' });
  expect(command).not.toHaveBeenCalled();
});

it('retries a compressed native hierarchy when an animated cloud Settings page never becomes idle', async () => {
  let compressed = false;
  const command = vi.fn(async (_path: string, args: string[], _signal: AbortSignal) => {
    if (args.includes('dump')) { compressed = args.includes('--compressed'); return Buffer.from(compressed ? 'UI hierarchy dumped' : 'ERROR: could not get idle state.'); }
    if (args.includes('cat')) return Buffer.from(compressed ? '<hierarchy><node text="Android version" content-desc="" resource-id="android:id/title" bounds="[0,0][100,100]" clickable="true" password="false" focused="false" /></hierarchy>' : 'cat: no such file');
    return Buffer.alloc(0);
  });
  const driver = new AdbPhoneDriver('test-adb', command, false);
  vi.spyOn(driver, 'capture').mockResolvedValue({ frameId: 'test', capturedAt: Date.now(), width: 1080, height: 2400, rotation: 0, package: 'com.android.settings', frame: Buffer.alloc(0), elements: [] });
  const result = await driver.observe('cloud-test', new AbortController().signal);
  expect(result.elements).toMatchObject([{ text: 'Android version' }]);
  const dumps = command.mock.calls.filter(([, args]) => args.includes('dump'));
  expect(dumps).toHaveLength(2); expect(dumps[1][1]).toContain('--compressed');
  expect(command.mock.calls.filter(([, args]) => args.includes('rm'))).toHaveLength(2);
});
