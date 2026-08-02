import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../connection.js';
import {
  buildRelationshipPrompt,
  getRelationshipSettings,
  isProactiveSupportAllowed,
  updateRelationshipSettings,
} from '../relationship-settings-repository.js';

describe('relationship settings repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-relationship-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('stores one global support mode and builds bounded guidance', () => {
    expect(getRelationshipSettings()).toMatchObject({
      supportMode: 'auto',
      proactiveEnabled: false,
      allowedTopics: [],
      blockedTopics: [],
    });

    const settings = updateRelationshipSettings({ supportMode: 'companion' });
    expect(getRelationshipSettings().supportMode).toBe('companion');

    const prompt = buildRelationshipPrompt(settings);
    expect(prompt).toContain('Acknowledge the user’s experience');
    expect(prompt).toContain('Never claim to have human feelings');
    expect(prompt).toContain('emergency/professional services');
  });

  it('enforces proactive opt-in, topic boundaries, and overnight quiet hours', () => {
    const settings = updateRelationshipSettings({
      proactiveEnabled: true,
      quietStart: '22:00',
      quietEnd: '07:00',
      blockedTopics: ['health'],
    });
    expect(isProactiveSupportAllowed(settings, { now: new Date(2026, 0, 1, 12), topic: 'progress' })).toBe(true);
    expect(isProactiveSupportAllowed(settings, { now: new Date(2026, 0, 1, 23), topic: 'progress' })).toBe(false);
    expect(isProactiveSupportAllowed(settings, { now: new Date(2026, 0, 1, 12), topic: 'health' })).toBe(false);
  });
});
