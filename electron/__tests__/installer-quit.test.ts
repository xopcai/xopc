import { afterEach, describe, expect, it, vi } from 'vitest';

import { finishQuitCleanup, isInstallerQuitRequest } from '../installer-quit.js';

afterEach(() => vi.useRealTimers());

describe('installer quit', () => {
  it('only accepts the explicit argument in a packaged Windows app', () => {
    expect(isInstallerQuitRequest(['xopc.exe', '--quit-for-install'], 'win32', true)).toBe(true);
    expect(isInstallerQuitRequest(['xopc.exe', 'file--quit-for-install'], 'win32', true)).toBe(false);
    expect(isInstallerQuitRequest(['--quit-for-install'], 'darwin', true)).toBe(false);
    expect(isInstallerQuitRequest(['--quit-for-install'], 'win32', false)).toBe(false);
  });

  it('waits for every cleanup operation before allowing a normal quit', async () => {
    let close!: () => void;
    const pending = new Promise<void>(resolve => { close = resolve; });
    const report = vi.fn();
    let finished = false;
    const cleanup = finishQuitCleanup([() => Promise.resolve(), () => pending, () => undefined], report)
      .then(result => { finished = true; return result; });
    await Promise.resolve();
    expect(finished).toBe(false);
    close();
    expect(await cleanup).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });

  it('bounds a connection that never closes', async () => {
    vi.useFakeTimers();
    const report = vi.fn();
    const cleanup = finishQuitCleanup([() => new Promise(() => {})], report, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await cleanup).toBe(false);
    expect(report).toHaveBeenCalledWith('Quit cleanup timed out after 100ms');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still runs other cleanup operations after a synchronous failure', async () => {
    const report = vi.fn();
    const close = vi.fn(async () => undefined);
    expect(await finishQuitCleanup([() => { throw new Error('failed close'); }, close], report)).toBe(false);
    expect(close).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('Error: failed close');
  });
});
