import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveStateDir } from '../config/paths-state.js';
import { writeTextAtomic } from '../infra/write-file-atomic.js';

export type XopcCloudOnboardingStatus = 'unseen' | 'dismissed';

function statePath(): string {
  return join(resolveStateDir(), 'xopc-cloud-onboarding.json');
}

export async function getXopcCloudOnboardingStatus(): Promise<XopcCloudOnboardingStatus> {
  try {
    const parsed: unknown = JSON.parse(await readFile(statePath(), 'utf8'));
    return parsed && typeof parsed === 'object' && 'status' in parsed
      && parsed.status === 'dismissed' ? 'dismissed' : 'unseen';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'unseen';
    throw error;
  }
}

export async function dismissXopcCloudOnboarding(): Promise<void> {
  await writeTextAtomic(statePath(), JSON.stringify({ version: 1, status: 'dismissed' }));
}
