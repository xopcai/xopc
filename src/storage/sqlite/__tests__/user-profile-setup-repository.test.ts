import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  getUserProfilePromptState,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  setUserProfilePromptState,
} from '../index.js';

describe('user profile prompt repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-profile-prompt-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('defaults to active and persists snooze state', () => {
    expect(getUserProfilePromptState()).toEqual({ state: 'active' });
    const saved = setUserProfilePromptState({
      state: 'snoozed',
      suggestionHash: 'candidate-1',
      snoozedUntil: '2026-07-26T00:00:00.000Z',
    });
    expect(saved).toMatchObject({
      state: 'snoozed',
      suggestionHash: 'candidate-1',
      snoozedUntil: '2026-07-26T00:00:00.000Z',
    });
  });
});
