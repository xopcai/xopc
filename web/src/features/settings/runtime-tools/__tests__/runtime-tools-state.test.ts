import { describe, expect, it } from 'vitest';

import type { RuntimeStatus } from '../runtime-tools-api';
import { runtimeNeedsInstall } from '../runtime-tools-state';

const readyStatus: RuntimeStatus = {
  runtime: 'node',
  state: 'ready',
  requestedVersion: '22.23.2',
  message: 'node 22.23.2 is ready (managed)',
  repairable: false,
  resolved: {
    version: '22.23.2',
    source: 'managed',
    executable: '/tmp/node',
  },
};

describe('runtimeNeedsInstall', () => {
  it('does not offer installation when the saved target is already ready', () => {
    expect(runtimeNeedsInstall(readyStatus, '22.23.2', '22.23.2')).toBe(false);
    expect(runtimeNeedsInstall(readyStatus, undefined, undefined)).toBe(false);
  });

  it('offers installation when the target version changes', () => {
    expect(runtimeNeedsInstall(readyStatus, '24.0.0', '22.23.2')).toBe(true);
  });

  it('offers installation when the runtime is not ready', () => {
    expect(runtimeNeedsInstall({ ...readyStatus, state: 'absent', resolved: undefined }, '22.23.2', '22.23.2')).toBe(true);
  });
});
