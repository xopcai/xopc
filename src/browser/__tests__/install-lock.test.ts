import { describe, expect, it } from 'vitest';

import { acquireBrowserInstallLock } from '../install-lock.js';

describe('acquireBrowserInstallLock', () => {
  it('allows one holder at a time', () => {
    const first = acquireBrowserInstallLock();
    expect(first).not.toBeNull();
    expect(acquireBrowserInstallLock()).toBeNull();
    first!.release();
    const second = acquireBrowserInstallLock();
    expect(second).not.toBeNull();
    second!.release();
  });
});
