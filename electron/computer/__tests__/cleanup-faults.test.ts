import { afterEach, expect, it, vi } from 'vitest';
import { CuaComputerDriver } from '../cua-driver.js';

afterEach(() => vi.useRealTimers());
it('stops the owned daemon even when its RPC shutdown never replies', async () => {
  vi.useFakeTimers();
  const driver = new CuaComputerDriver('fixture', 'host');
  const host = { stop: vi.fn(async () => {}), uniffiDestroy: vi.fn() };
  Object.assign(driver, { client: { shutdown: () => new Promise(() => {}), uniffiDestroy: vi.fn() }, host });
  const stopped = driver.stop();
  await vi.advanceTimersByTimeAsync(751); await stopped;
  expect(host.stop).toHaveBeenCalledOnce(); expect(host.uniffiDestroy).toHaveBeenCalledOnce();
});
it('keeps an unconfirmed daemon quarantined until explicit cleanup succeeds', async () => {
  vi.useFakeTimers();
  const driver = new CuaComputerDriver('fixture', 'host');
  const host = { stop: vi.fn(() => new Promise<void>(() => {})), uniffiDestroy: vi.fn() };
  Object.assign(driver, { host });
  const failed = expect(driver.stop()).rejects.toThrow('CLEANUP_UNCONFIRMED');
  await vi.advanceTimersByTimeAsync(3001); await failed;
  await expect(driver.discover('', new AbortController().signal)).rejects.toThrow('CLEANUP_UNCONFIRMED');
  expect(host.uniffiDestroy).not.toHaveBeenCalled();
  host.stop.mockResolvedValue(undefined); await driver.stop();
  expect(host.stop).toHaveBeenCalledTimes(2); expect(host.uniffiDestroy).toHaveBeenCalledOnce();
});
it('still stops the daemon when native client disposal throws', async () => {
  const driver = new CuaComputerDriver('fixture', 'host'); const stop = vi.fn(async () => {});
  Object.assign(driver, { client: { shutdown: async () => {}, uniffiDestroy: () => { throw new Error('destroy failed'); } }, host: { stop } });
  await driver.stop(); expect(stop).toHaveBeenCalledOnce();
});
it('does not report a failed daemon stop as confirmed release', async () => {
  const driver = new CuaComputerDriver('fixture', 'host');
  const host = { stop: vi.fn(async () => { throw new Error('native stop refused'); }) };
  Object.assign(driver, { host });
  await expect(driver.stop()).rejects.toThrow('COMPUTER_DRIVER_CLEANUP_UNCONFIRMED');
  await expect(driver.discover('', new AbortController().signal)).rejects.toThrow('CLEANUP_UNCONFIRMED');
  expect(host.stop).toHaveBeenCalledOnce();
});
