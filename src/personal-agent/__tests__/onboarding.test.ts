import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { completePersonalOnboarding, finishPersonalWelcome, getPersonalOnboarding, savePersonalOnboarding } from '../onboarding.js';

describe('personal onboarding', () => {
  it('persists a draft, resumes it, and completes each stage once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-personal-onboard-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    try {
      expect(getPersonalOnboarding('local-owner')).toMatchObject({
        step: 'intro', draft: { displayName: 'Ada', appearance: 'loopi', voice: null }, completed: false, welcomeDone: false,
      });
      savePersonalOnboarding('local-owner', 'voice', { displayName: 'Mira', appearance: 'loopi-care', voice: 'Serena' });
      expect(getPersonalOnboarding('local-owner')).toMatchObject({
        step: 'voice', draft: { displayName: 'Mira', appearance: 'loopi-care', voice: 'Serena' }, completed: false,
      });
      completePersonalOnboarding('local-owner');
      savePersonalOnboarding('local-owner', 'intro', { displayName: 'Other', appearance: 'loopi', voice: null });
      expect(getPersonalOnboarding('local-owner')).toMatchObject({
        step: 'voice', draft: { displayName: 'Mira' }, completed: true, welcomeDone: false,
      });
      finishPersonalWelcome('local-owner');
      finishPersonalWelcome('local-owner');
      expect(getPersonalOnboarding('local-owner').welcomeDone).toBe(true);
    } finally {
      closeXopcDatabase();
      resetXopcDatabaseSingletonForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
