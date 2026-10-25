import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import { AdbPhoneDriver } from '../adb-driver.js';
import { canDispatchPhoneAction } from '../reliability.js';

const xml = '<?xml version="1.0"?><hierarchy><node text="About phone" resource-id="about" clickable="true" bounds="[0,0][100,100]"/></hierarchy>';

async function fixture(dumps: string[], hierarchy = xml) {
  const image = await sharp({ create: { width: 100, height: 200, channels: 3, background: 'white' } }).png().toBuffer();
  const command = vi.fn(async (_path: string, args: string[]) => {
    if (args.includes('uiautomator')) {
      const result = dumps.shift() ?? 'success';
      return Buffer.from(result === 'success' ? `UI hierchary dumped to: ${args.at(-1)}` : result);
    }
    if (args.includes('cat')) return Buffer.from(hierarchy);
    if (args.includes('screencap')) return image;
    if (args.includes('activities')) return Buffer.from('mResumedActivity: ActivityRecord{ com.android.settings/.Settings }');
    return Buffer.alloc(0);
  });
  return { command, driver: new AdbPhoneDriver('adb', command, false) };
}

describe('phone hierarchy acquisition', () => {
  it('retries interrupted dumps without switching hierarchy modes or publishing missing nodes', async () => {
    const { driver, command } = await fixture(['success', 'Killed', 'success']);
    const before = await driver.observe('phone', AbortSignal.timeout(10_000));
    const fresh = await driver.observe('phone', AbortSignal.timeout(10_000));
    expect(fresh.elements).toEqual(before.elements);
    expect(canDispatchPhoneAction({ type: 'tap', point: [100, 100] }, before, fresh)).toBe(true);
    const dumps = command.mock.calls.filter(([, args]) => args.includes('uiautomator'));
    expect(dumps).toHaveLength(3);
    expect(dumps.every(([, args]) => args.includes('--compressed'))).toBe(true);
    expect(command.mock.calls.filter(([, args]) => args.includes('cat'))).toHaveLength(2);
    expect(command.mock.calls.filter(([, args]) => args.includes('rm'))).toHaveLength(3);
  });

  it('reports persistent acquisition failure before pixels can masquerade as a changed native screen', async () => {
    const { driver, command } = await fixture(['Killed', 'Killed', 'Killed']);
    await expect(driver.observe('phone', AbortSignal.timeout(10_000))).rejects.toMatchObject({ code: 'PHONE_UI_UNAVAILABLE' });
    expect(command.mock.calls.some(([, args]) => args.includes('screencap'))).toBe(false);
    expect(command.mock.calls.filter(([, args]) => args.includes('rm'))).toHaveLength(3);
  });

  it('does not retry after cancellation', async () => {
    const { driver, command } = await fixture(['Killed']);
    const controller = new AbortController();
    const result = driver.observe('phone', controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(command.mock.calls.filter(([, args]) => args.includes('uiautomator'))).toHaveLength(1);
  });

  it('preserves screenshot fallback for a successfully captured empty hierarchy', async () => {
    const { driver, command } = await fixture(['success'], '<?xml version="1.0"?><hierarchy rotation="0"/>');
    const observation = await driver.observe('phone', AbortSignal.timeout(10_000));
    expect(observation.elements).toEqual([]);
    expect(observation.frame.length).toBeGreaterThan(0);
    expect(command.mock.calls.filter(([, args]) => args.includes('uiautomator'))).toHaveLength(1);
  });

  it('uses the cloud non-idle reader and rejects a hierarchy from a different application', async () => {
    const { command } = await fixture([]);
    const hierarchy = vi.fn(async () => xml.replace('<node ', '<node package="com.android.settings" '));
    const driver = new AdbPhoneDriver('adb', command, false, undefined, undefined, hierarchy);
    expect((await driver.observe('phone', AbortSignal.timeout(10_000))).elements[0].text).toBe('About phone');
    expect(command.mock.calls.some(([, args]) => args.includes('uiautomator'))).toBe(false);
    hierarchy.mockResolvedValueOnce(xml.replace('<node ', '<node package="com.other.app" '));
    await expect(driver.observe('phone', AbortSignal.timeout(10_000))).rejects.toMatchObject({ code: 'PHONE_FRAME_CHANGED' });
  });
});
