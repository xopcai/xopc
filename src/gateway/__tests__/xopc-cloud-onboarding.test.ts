import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dismissXopcCloudOnboarding, getXopcCloudOnboardingStatus } from '../xopc-cloud-onboarding.js';

describe('XOPC Cloud onboarding state', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-cloud-onboarding-'));
    vi.stubEnv('XOPC_STATE_DIR', directory);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it('starts unseen and keeps dismissal across reads', async () => {
    expect(await getXopcCloudOnboardingStatus()).toBe('unseen');
    await dismissXopcCloudOnboarding();
    expect(await getXopcCloudOnboardingStatus()).toBe('dismissed');
  });
});
