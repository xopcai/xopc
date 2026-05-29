import { afterEach, describe, expect, it } from 'vitest';

import {
  acquireBrowserInstallLock,
  cancelBrowserInstall,
  resetBrowserInstallLockForTests,
} from '../install-lock.js';

describe('acquireBrowserInstallLock', () => {
  afterEach(() => {
    resetBrowserInstallLockForTests();
  });

  it('allows parallel locks for different browser kinds', () => {
    const playwright = acquireBrowserInstallLock('playwright');
    const cloak = acquireBrowserInstallLock('cloakbrowser');
    expect(playwright).not.toBeNull();
    expect(cloak).not.toBeNull();
    playwright!.release();
    cloak!.release();
  });

  it('rejects a second lock of the same kind', () => {
    const first = acquireBrowserInstallLock('playwright');
    expect(first).not.toBeNull();
    expect(acquireBrowserInstallLock('playwright')).toBeNull();
    first!.release();
    expect(acquireBrowserInstallLock('playwright')).not.toBeNull();
    acquireBrowserInstallLock('playwright')?.release();
  });

  it('release is idempotent', () => {
    const lock = acquireBrowserInstallLock('cloakbrowser');
    lock!.release();
    lock!.release();
    expect(acquireBrowserInstallLock('cloakbrowser')).not.toBeNull();
    acquireBrowserInstallLock('cloakbrowser')?.release();
  });

  it('cancelBrowserInstall aborts the active signal and frees the kind', () => {
    const lock = acquireBrowserInstallLock('playwright')!;
    let aborted = false;
    lock.signal.addEventListener('abort', () => {
      aborted = true;
    });
    expect(cancelBrowserInstall('playwright')).toBe(true);
    expect(aborted).toBe(true);
    lock.release();
    expect(acquireBrowserInstallLock('playwright')).not.toBeNull();
    acquireBrowserInstallLock('playwright')?.release();
  });

  it('cancelBrowserInstall returns false when idle', () => {
    expect(cancelBrowserInstall('cloakbrowser')).toBe(false);
  });
});
