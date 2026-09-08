import { afterEach, describe, expect, it } from 'vitest';

import { acquireBrowserInstallLock, cancelBrowserInstall, resetBrowserInstallLockForTests } from '../install-lock.js';

describe('Playwright install lock', () => {
  afterEach(resetBrowserInstallLockForTests);

  it('allows one active install and releases idempotently', () => {
    const lock = acquireBrowserInstallLock('playwright');
    expect(lock).not.toBeNull();
    expect(acquireBrowserInstallLock('playwright')).toBeNull();
    lock?.release();
    lock?.release();
    expect(acquireBrowserInstallLock('playwright')).not.toBeNull();
  });

  it('aborts an active install', () => {
    const lock = acquireBrowserInstallLock('playwright');
    expect(cancelBrowserInstall('playwright')).toBe(true);
    expect(lock?.signal.aborted).toBe(true);
  });
});
